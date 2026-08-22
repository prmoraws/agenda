import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import pg from 'pg';
import {
  buildOccurrenceDates, extractWhatsappInviteCode, parseWhatsappInviteLinks,
  validateDraft, validateGroup, validateLabel, validateMessageTemplate, validateRecurrence,
} from './domain.mjs';
import {
  connectInstance, createInstance, fetchGroupInviteInfo, fetchGroups, fetchInstances, fetchLabels,
  findInstance, normalizeGroups, normalizeInviteGroup, normalizeLabels, sendImageMessage, sendTextMessage,
} from './evolution.mjs';
import { startDeliveryWorker } from './delivery-worker.mjs';
import {
  readMediaBase64, removeMedia, saveMedia, validateMediaInput,
} from './media-storage.mjs';

const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const instanceName = process.env.DOMO_BUSINESS_INSTANCE_NAME ?? 'domo-business-agendamentos';
const sendingEnabled = process.env.WHATSAPP_SENDING_ENABLED === 'true';
const configuredWorkerInterval = Number(process.env.DELIVERY_WORKER_INTERVAL_MS ?? 15_000);
const workerIntervalMs = Number.isInteger(configuredWorkerInterval)
  && configuredWorkerInterval >= 5_000 && configuredWorkerInterval <= 60_000
  ? configuredWorkerInterval : 15_000;
const publicRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
let groupImportInProgress = false;

const removeMediaIfUnused = async filePath => {
  if (!filePath) return;
  const { rowCount } = await pool.query(`
    SELECT 1 FROM business_messages
    WHERE media_path = $1 AND status <> 'deleted' LIMIT 1
  `, [filePath]);
  if (!rowCount) await removeMedia(filePath);
};

await app.register(fastifyStatic, { root: publicRoot });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { status: 'ok', service: 'agenda', sendingEnabled };
});

app.get('/api/whatsapp/status', async () => {
  const payload = await fetchInstances();
  const instance = findInstance(payload, instanceName);
  return {
    instanceName,
    exists: Boolean(instance),
    state: instance?.connectionStatus ?? instance?.instance?.state ?? instance?.state ?? 'not_created',
    sendingEnabled,
  };
});

app.post('/api/whatsapp/instance', async () => {
  const existing = findInstance(await fetchInstances(), instanceName);
  if (existing) return { status: 'already_exists', instanceName, sendingEnabled };
  await createInstance(instanceName);
  return { status: 'created', instanceName, sendingEnabled };
});

app.get('/api/worker/status', async () => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE d.status IN ('pending','failed')
          AND d.attempt_count < d.max_attempts
          AND m.status IN ('confirmed','processing')
          AND m.scheduled_at <= NOW()
          AND COALESCE(d.next_attempt_at, m.scheduled_at) <= NOW()
      )::int AS "readyDeliveries",
      COUNT(*) FILTER (WHERE d.status = 'processing')::int AS "processingDeliveries",
      COUNT(*) FILTER (WHERE d.status = 'sent')::int AS "sentDeliveries",
      COUNT(*) FILTER (
        WHERE d.status = 'failed' AND d.attempt_count >= d.max_attempts
      )::int AS "exhaustedDeliveries"
    FROM business_deliveries d
    JOIN business_messages m ON m.id = d.message_id
  `);
  return { enabled: sendingEnabled, intervalMs: workerIntervalMs, ...rows[0] };
});

app.get('/api/whatsapp/qrcode', async () => {
  const payload = await connectInstance(instanceName);
  const base64 = payload?.base64 ?? payload?.qrcode?.base64 ?? payload?.code ?? null;
  return { instanceName, base64, pairingCode: payload?.pairingCode ?? null };
});

app.post('/api/whatsapp/import-groups', async (_request, reply) => {
  if (groupImportInProgress) {
    return reply.code(409).send({ error: 'Uma importação de grupos já está em andamento' });
  }
  groupImportInProgress = true;
  try {
    const groups = normalizeGroups(await fetchGroups(instanceName));
    let imported = 0;
    for (const group of groups) {
      const result = await pool.query(`
        INSERT INTO business_groups (
          instance_name, group_jid, display_name, group_kind, community_jid, sendable
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (instance_name, group_jid)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          group_kind = EXCLUDED.group_kind,
          community_jid = EXCLUDED.community_jid,
          sendable = EXCLUDED.sendable,
          updated_at = NOW()
        RETURNING id
      `, [
        instanceName, group.groupJid, group.displayName, group.groupKind,
        group.communityJid, group.sendable,
      ]);
      imported += result.rowCount;
    }
    const kinds = groups.reduce((totals, group) => {
      totals[group.groupKind] = (totals[group.groupKind] ?? 0) + 1;
      return totals;
    }, {});
    return {
      status: 'ok', discovered: groups.length, imported, kinds,
      authorizedAutomatically: false,
    };
  } finally {
    groupImportInProgress = false;
  }
});

app.get('/api/groups', async () => {
  const { rows } = await pool.query(`
    SELECT g.id, g.group_jid AS "groupJid", g.display_name AS "displayName",
      g.group_kind AS "groupKind", g.community_jid AS "communityJid", g.sendable,
      g.authorized, g.active, g.confirmed_at AS "confirmedAt",
      COALESCE(
        jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color, 'source', l.source)
          ORDER BY l.name) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb
      ) AS labels
    FROM business_groups g
    LEFT JOIN business_group_labels gl ON gl.group_id = g.id
    LEFT JOIN business_labels l ON l.id = gl.label_id AND l.active = TRUE
    GROUP BY g.id ORDER BY g.display_name
  `);
  return rows;
});

app.get('/api/labels', async () => {
  const { rows } = await pool.query(`
    SELECT l.id, l.name, l.color, l.source, l.external_id AS "externalId",
      COUNT(gl.group_id)::int AS "groupCount"
    FROM business_labels l
    LEFT JOIN business_group_labels gl ON gl.label_id = l.id
    WHERE l.active = TRUE
    GROUP BY l.id ORDER BY l.name
  `);
  return rows;
});

app.get('/api/templates', async () => {
  const { rows } = await pool.query(`
    SELECT id, name, content, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM business_message_templates WHERE active = TRUE ORDER BY name
  `);
  return rows;
});

app.post('/api/templates', async (request, reply) => {
  const template = validateMessageTemplate(request.body ?? {});
  const { rows } = await pool.query(`
    INSERT INTO business_message_templates (name, content)
    VALUES ($1, $2)
    ON CONFLICT (name) DO UPDATE SET
      content = EXCLUDED.content, active = TRUE, updated_at = NOW()
    RETURNING id, name, content
  `, [template.name, template.content]);
  return reply.code(201).send(rows[0]);
});

app.delete('/api/templates/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const { rows } = await pool.query(`
    UPDATE business_message_templates SET active = FALSE, updated_at = NOW()
    WHERE id = $1 AND active = TRUE RETURNING id
  `, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Modelo não encontrado' });
  return { status: 'archived', id };
});

app.post('/api/labels', async (request, reply) => {
  const label = validateLabel(request.body ?? {});
  const { rows } = await pool.query(`
    INSERT INTO business_labels (name, color, source)
    VALUES ($1, $2, 'agenda')
    ON CONFLICT (source, name) DO UPDATE
      SET color = EXCLUDED.color, active = TRUE, updated_at = NOW()
    RETURNING id, name, color, source
  `, [label.name, label.color]);
  return reply.code(201).send(rows[0]);
});

app.post('/api/labels/import', async () => {
  const importedLabels = normalizeLabels(await fetchLabels(instanceName));
  let imported = 0;
  for (const label of importedLabels) {
    const result = await pool.query(`
      INSERT INTO business_labels (name, color, source, external_id)
      VALUES ($1, $2, 'evolution', $3)
      ON CONFLICT (source, external_id) DO UPDATE
        SET name = EXCLUDED.name, color = EXCLUDED.color,
          active = TRUE, updated_at = NOW()
      RETURNING id
    `, [label.name, label.color, label.externalId]);
    imported += result.rowCount;
  }
  return {
    status: 'ok', discovered: importedLabels.length, imported,
    associationsImported: false,
    warning: 'A Evolution 2.3.7 não fornece associações confiáveis entre etiquetas e grupos',
  };
});

app.put('/api/groups/:id/labels', async (request, reply) => {
  const groupId = Number(request.params.id);
  const labelIds = [...new Set((Array.isArray(request.body?.labelIds) ? request.body.labelIds : [])
    .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (labelIds.length > 50) throw new Error('Quantidade excessiva de etiquetas');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = await client.query('SELECT id FROM business_groups WHERE id = $1 AND active = TRUE', [groupId]);
    if (!group.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'Grupo não encontrado' });
    }
    if (labelIds.length) {
      const valid = await client.query(`
        SELECT id FROM business_labels WHERE id = ANY($1::bigint[]) AND active = TRUE
      `, [labelIds]);
      if (valid.rowCount !== labelIds.length) throw new Error('Há etiqueta inexistente');
    }
    await client.query('DELETE FROM business_group_labels WHERE group_id = $1', [groupId]);
    for (const labelId of labelIds) {
      await client.query(`
        INSERT INTO business_group_labels (group_id, label_id) VALUES ($1, $2)
      `, [groupId, labelId]);
    }
    await client.query('COMMIT');
    return { status: 'ok', groupId, labelIds };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/groups', async (request, reply) => {
  const group = validateGroup(request.body ?? {});
  const { rows } = await pool.query(`
    INSERT INTO business_groups (instance_name, group_jid, display_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (instance_name, group_jid)
    DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
    RETURNING id, group_jid AS "groupJid", display_name AS "displayName", authorized, active
  `, [instanceName, group.groupJid, group.displayName]);
  return reply.code(201).send(rows[0]);
});

app.post('/api/groups/from-invite', async (request, reply) => {
  const inviteCode = extractWhatsappInviteCode(request.body?.inviteUrl);
  const group = validateGroup(normalizeInviteGroup(
    await fetchGroupInviteInfo(instanceName, inviteCode),
  ));
  const { rows } = await pool.query(`
    INSERT INTO business_groups (
      instance_name, group_jid, display_name, group_kind, sendable
    ) VALUES ($1, $2, $3, 'group', TRUE)
    ON CONFLICT (instance_name, group_jid)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      active = TRUE,
      updated_at = NOW()
    RETURNING id, group_jid AS "groupJid", display_name AS "displayName",
      authorized, active
  `, [instanceName, group.groupJid, group.displayName]);
  return reply.code(201).send({ status: 'created', group: rows[0] });
});

app.post('/api/groups/from-invites', async (request, reply) => {
  const inviteUrls = parseWhatsappInviteLinks(request.body?.inviteUrls);
  const results = [];
  for (const inviteUrl of inviteUrls) {
    try {
      const inviteCode = extractWhatsappInviteCode(inviteUrl);
      const group = validateGroup(normalizeInviteGroup(
        await fetchGroupInviteInfo(instanceName, inviteCode),
      ));
      const existing = await pool.query(`
        SELECT id FROM business_groups
        WHERE instance_name = $1 AND group_jid = $2
      `, [instanceName, group.groupJid]);
      const { rows } = await pool.query(`
        INSERT INTO business_groups (
          instance_name, group_jid, display_name, group_kind, sendable
        ) VALUES ($1, $2, $3, 'group', TRUE)
        ON CONFLICT (instance_name, group_jid)
        DO UPDATE SET display_name = EXCLUDED.display_name, active = TRUE, updated_at = NOW()
        RETURNING id, group_jid AS "groupJid", display_name AS "displayName", authorized
      `, [instanceName, group.groupJid, group.displayName]);
      results.push({
        inviteUrl, status: existing.rowCount ? 'existing' : 'added', group: rows[0],
      });
    } catch (error) {
      results.push({
        inviteUrl, status: 'failed',
        error: error instanceof Error ? error.message : 'Não foi possível consultar o convite',
      });
    }
  }
  const summary = {
    total: results.length,
    added: results.filter(result => result.status === 'added').length,
    existing: results.filter(result => result.status === 'existing').length,
    failed: results.filter(result => result.status === 'failed').length,
  };
  return reply.code(summary.added ? 201 : 200).send({ status: 'processed', summary, results });
});

app.post('/api/groups/:id/authorize', async (request, reply) => {
  const id = Number(request.params.id);
  const { rows } = await pool.query(`
    UPDATE business_groups SET authorized = TRUE, confirmed_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND active = TRUE AND sendable = TRUE RETURNING id
  `, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Grupo não encontrado' });
  return { status: 'authorized', id };
});

const groupHasFutureDeliveries = async groupId => {
  const { rowCount } = await pool.query(`
    SELECT 1
    FROM business_deliveries d
    JOIN business_messages m ON m.id = d.message_id
    WHERE d.group_id = $1
      AND d.status IN ('pending','processing','failed')
      AND m.status IN ('confirmed','processing')
      AND m.scheduled_at > NOW()
    LIMIT 1
  `, [groupId]);
  return rowCount > 0;
};

app.put('/api/groups/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const displayName = String(request.body?.displayName ?? '').trim();
  if (displayName.length < 2 || displayName.length > 200) {
    throw new Error('Nome do grupo deve ter entre 2 e 200 caracteres');
  }
  const { rows } = await pool.query(`
    UPDATE business_groups SET display_name = $2, updated_at = NOW()
    WHERE id = $1 RETURNING id, display_name AS "displayName"
  `, [id, displayName]);
  if (!rows.length) return reply.code(404).send({ error: 'Grupo não encontrado' });
  return { status: 'updated', group: rows[0] };
});

app.post('/api/groups/:id/revoke', async (request, reply) => {
  const id = Number(request.params.id);
  if (await groupHasFutureDeliveries(id)) {
    return reply.code(409).send({
      error: 'Cancele os agendamentos futuros deste grupo antes de retirar a autorização',
    });
  }
  const { rows } = await pool.query(`
    UPDATE business_groups
    SET authorized = FALSE, confirmed_at = NULL, updated_at = NOW()
    WHERE id = $1 AND active = TRUE RETURNING id
  `, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Grupo ativo não encontrado' });
  return { status: 'revoked', id };
});

app.delete('/api/groups/:id', async (request, reply) => {
  const id = Number(request.params.id);
  if (await groupHasFutureDeliveries(id)) {
    return reply.code(409).send({
      error: 'Cancele os agendamentos futuros deste grupo antes de arquivá-lo',
    });
  }
  const { rows } = await pool.query(`
    UPDATE business_groups
    SET active = FALSE, authorized = FALSE, confirmed_at = NULL, updated_at = NOW()
    WHERE id = $1 AND active = TRUE RETURNING id
  `, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Grupo ativo não encontrado' });
  return { status: 'archived', id };
});

app.post('/api/groups/:id/restore', async (request, reply) => {
  const id = Number(request.params.id);
  const { rows } = await pool.query(`
    UPDATE business_groups SET active = TRUE, updated_at = NOW()
    WHERE id = $1 AND active = FALSE RETURNING id
  `, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Grupo arquivado não encontrado' });
  return { status: 'restored', id };
});

app.get('/api/messages', async request => {
  const views = {
    active: ['draft','confirmed','processing'],
    sent: ['completed','partial_failed','failed'],
    cancelled: ['cancelled'],
    all: ['draft','confirmed','processing','completed','partial_failed','failed','cancelled'],
  };
  const view = Object.hasOwn(views, request.query?.view) ? request.query.view : 'active';
  const { rows } = await pool.query(`
    SELECT m.id, m.content, m.scheduled_at AS "scheduledAt", m.status,
      m.confirmed_at AS "confirmedAt", m.cancelled_at AS "cancelledAt",
      (m.media_path IS NOT NULL) AS "hasMedia",
      m.series_id AS "seriesId", m.recurrence_type AS "recurrenceType",
      m.occurrence_number AS "occurrenceNumber",
      m.occurrence_count AS "occurrenceCount",
      COUNT(d.id)::int AS "groupCount"
    FROM business_messages m
    LEFT JOIN business_deliveries d ON d.message_id = m.id
    WHERE m.status = ANY($1::varchar[])
    GROUP BY m.id ORDER BY m.created_at DESC, m.occurrence_number ASC LIMIT 100
  `, [views[view]]);
  return rows;
});

app.get('/api/dashboard', async () => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('draft','confirmed','processing'))::int AS "activeMessages",
      COUNT(*) FILTER (WHERE status = 'confirmed')::int AS "confirmedMessages",
      COUNT(*) FILTER (WHERE status = 'completed')::int AS "completedMessages",
      COUNT(*) FILTER (WHERE status IN ('partial_failed','failed'))::int AS "failedMessages",
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS "cancelledMessages",
      COUNT(*) FILTER (WHERE recurrence_type = 'weekly' AND status <> 'deleted')::int AS "weeklyOccurrences",
      MIN(scheduled_at) FILTER (WHERE status = 'confirmed' AND scheduled_at > NOW()) AS "nextScheduledAt"
    FROM business_messages
    WHERE status <> 'deleted'
  `);
  const deliveries = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent')::int AS "sentDeliveries",
      COUNT(*) FILTER (WHERE status IN ('pending','processing'))::int AS "pendingDeliveries",
      COUNT(*) FILTER (WHERE status = 'failed')::int AS "failedDeliveries"
    FROM business_deliveries
  `);
  const groups = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE active = TRUE)::int AS "totalGroups",
      COUNT(*) FILTER (WHERE active = TRUE AND authorized = TRUE AND sendable = TRUE)::int AS "authorizedGroups"
    FROM business_groups
  `);
  const upcoming = await pool.query(`
    SELECT id, content, scheduled_at AS "scheduledAt",
      recurrence_type AS "recurrenceType", occurrence_number AS "occurrenceNumber",
      occurrence_count AS "occurrenceCount"
    FROM business_messages
    WHERE status = 'confirmed' AND scheduled_at > NOW()
    ORDER BY scheduled_at LIMIT 5
  `);
  return { ...rows[0], ...deliveries.rows[0], ...groups.rows[0], upcoming: upcoming.rows };
});

app.get('/api/messages/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const message = await pool.query(`
    SELECT id, content, scheduled_at AS "scheduledAt", timezone, status,
      confirmed_at AS "confirmedAt", cancelled_at AS "cancelledAt",
      created_at AS "createdAt", updated_at AS "updatedAt",
      media_original_name AS "mediaOriginalName",
      media_mime_type AS "mediaMimeType",
      series_id AS "seriesId", recurrence_type AS "recurrenceType",
      occurrence_number AS "occurrenceNumber", occurrence_count AS "occurrenceCount",
      CASE WHEN media_path IS NULL THEN NULL ELSE '/api/messages/' || id || '/media' END AS "mediaUrl"
    FROM business_messages WHERE id = $1 AND status <> 'deleted'
  `, [id]);
  if (!message.rowCount) return reply.code(404).send({ error: 'Agendamento não encontrado' });
  const deliveries = await pool.query(`
    SELECT d.id, d.status, d.attempt_count AS "attemptCount",
      d.max_attempts AS "maxAttempts", d.sent_at AS "sentAt",
      d.next_attempt_at AS "nextAttemptAt", d.error_code AS "errorCode",
      g.id AS "groupId", g.display_name AS "groupName", g.group_jid AS "groupJid"
    FROM business_deliveries d
    JOIN business_groups g ON g.id = d.group_id
    WHERE d.message_id = $1 ORDER BY g.display_name, g.group_jid
  `, [id]);
  return { ...message.rows[0], deliveries: deliveries.rows };
});

app.get('/api/messages/:id/media', async (request, reply) => {
  const id = Number(request.params.id);
  const { rows } = await pool.query(`
    SELECT media_path, media_mime_type FROM business_messages
    WHERE id = $1 AND status <> 'deleted' AND media_path IS NOT NULL
  `, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Foto não encontrada' });
  const base64 = await readMediaBase64(rows[0].media_path);
  return reply.type(rows[0].media_mime_type).header('Cache-Control', 'private, max-age=300')
    .send(Buffer.from(base64, 'base64'));
});

app.post('/api/messages/:id/reuse', async (request, reply) => {
  const sourceId = Number(request.params.id);
  const scheduledAt = new Date(request.body?.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    throw new Error('Escolha uma data e horário futuros');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const source = await client.query(`
      SELECT content, media_path, media_mime_type, media_original_name
      FROM business_messages
      WHERE id = $1 AND status <> 'deleted'
      FOR SHARE
    `, [sourceId]);
    if (!source.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'Agendamento original não encontrado' });
    }
    const destinations = await client.query(`
      SELECT DISTINCT g.id
      FROM business_deliveries d
      JOIN business_groups g ON g.id = d.group_id
      WHERE d.message_id = $1
        AND g.active = TRUE AND g.authorized = TRUE AND g.sendable = TRUE
      ORDER BY g.id
    `, [sourceId]);
    const originalCount = await client.query(`
      SELECT COUNT(DISTINCT group_id)::int AS total
      FROM business_deliveries WHERE message_id = $1
    `, [sourceId]);
    if (!destinations.rowCount) throw new Error('Nenhum grupo original continua ativo e autorizado');
    const original = source.rows[0];
    const inserted = await client.query(`
      INSERT INTO business_messages (
        content, scheduled_at, idempotency_key,
        media_path, media_mime_type, media_original_name
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, status
    `, [
      original.content, scheduledAt.toISOString(), crypto.randomUUID(),
      original.media_path, original.media_mime_type, original.media_original_name,
    ]);
    for (const destination of destinations.rows) {
      await client.query(`
        INSERT INTO business_deliveries (message_id, group_id) VALUES ($1, $2)
      `, [inserted.rows[0].id, destination.id]);
    }
    await client.query('COMMIT');
    return reply.code(201).send({
      status: 'draft', id: inserted.rows[0].id,
      copiedGroups: destinations.rowCount,
      skippedGroups: originalCount.rows[0].total - destinations.rowCount,
      hasMedia: Boolean(original.media_path),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.put('/api/messages/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const draft = validateDraft(request.body ?? {});
  const mediaMode = ['keep', 'remove', 'replace'].includes(request.body?.mediaMode)
    ? request.body.mediaMode : 'keep';
  const mediaInput = mediaMode === 'replace' ? validateMediaInput(request.body?.media) : null;
  const client = await pool.connect();
  let savedMedia = null;
  let oldMediaPath = null;
  try {
    await client.query('BEGIN');
    const current = await client.query(`
      SELECT id, media_path, media_mime_type, media_original_name FROM business_messages
      WHERE id = $1 AND status IN ('draft','confirmed') FOR UPDATE
    `, [id]);
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'Este agendamento não pode mais ser editado' });
    }
    oldMediaPath = current.rows[0].media_path;
    if (mediaMode === 'replace') savedMedia = await saveMedia(mediaInput);
    const groups = await client.query(`
      SELECT id FROM business_groups
      WHERE id = ANY($1::bigint[]) AND active = TRUE
        AND authorized = TRUE AND sendable = TRUE
    `, [draft.groupIds]);
    if (groups.rowCount !== draft.groupIds.length) throw new Error('Há grupo inexistente ou não autorizado');
    const inProgress = await client.query(`
      SELECT 1 FROM business_deliveries
      WHERE message_id = $1 AND status IN ('processing','sent') LIMIT 1
    `, [id]);
    if (inProgress.rowCount) throw new Error('Agendamento já possui entrega processada e não pode ser editado');
    await client.query(`
      UPDATE business_messages SET content = $2, scheduled_at = $3,
        media_path = $4, media_mime_type = $5, media_original_name = $6,
        status = 'draft', confirmed_at = NULL, updated_at = NOW()
      WHERE id = $1
    `, [
      id, draft.content, draft.scheduledAt,
      mediaMode === 'keep' ? oldMediaPath : savedMedia?.filePath ?? null,
      mediaMode === 'keep' ? current.rows[0].media_mime_type : savedMedia?.mimeType ?? null,
      mediaMode === 'keep' ? current.rows[0].media_original_name : savedMedia?.originalName ?? null,
    ]);
    await client.query('DELETE FROM business_deliveries WHERE message_id = $1', [id]);
    for (const groupId of draft.groupIds) {
      await client.query(`
        INSERT INTO business_deliveries (message_id, group_id) VALUES ($1, $2)
      `, [id, groupId]);
    }
    await client.query('COMMIT');
    if (mediaMode !== 'keep' && oldMediaPath) {
      await removeMediaIfUnused(oldMediaPath).catch(error => {
        app.log.warn({ error: error.message }, 'Foto anterior não pôde ser removida');
      });
    }
    return { id, status: 'draft', requiresConfirmation: true };
  } catch (error) {
    await client.query('ROLLBACK');
    if (savedMedia?.filePath) await removeMedia(savedMedia.filePath);
    throw error;
  } finally {
    client.release();
  }
});

app.delete('/api/messages/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const blocked = await client.query(`
      SELECT 1 FROM business_deliveries
      WHERE message_id = $1 AND status IN ('processing','sent') LIMIT 1
    `, [id]);
    if (blocked.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'Agendamento com entrega processada não pode ser apagado' });
    }
    const result = await client.query(`
      UPDATE business_messages SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status IN ('draft','confirmed','cancelled') RETURNING id, media_path
    `, [id]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'Agendamento não pode ser apagado neste estado' });
    }
    await client.query(`
      UPDATE business_deliveries SET status = 'cancelled', updated_at = NOW()
      WHERE message_id = $1 AND status = 'pending'
    `, [id]);
    await client.query('COMMIT');
    await removeMediaIfUnused(result.rows[0].media_path).catch(error => {
      app.log.warn({ error: error.message }, 'Foto excluída não pôde ser removida');
    });
    return { status: 'deleted', id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/messages', async (request, reply) => {
  const draft = validateDraft(request.body ?? {});
  const recurrence = validateRecurrence(request.body ?? {});
  const mediaInput = validateMediaInput(request.body?.media);
  const client = await pool.connect();
  let savedMedia = null;
  try {
    await client.query('BEGIN');
    savedMedia = await saveMedia(mediaInput);
    const groups = await client.query(`
      SELECT id FROM business_groups
      WHERE id = ANY($1::bigint[]) AND active = TRUE
        AND authorized = TRUE AND sendable = TRUE
    `, [draft.groupIds]);
    if (groups.rowCount !== draft.groupIds.length) throw new Error('Há grupo inexistente ou ainda não autorizado');
    const seriesId = recurrence.recurrenceType === 'weekly' ? crypto.randomUUID() : null;
    const occurrenceDates = buildOccurrenceDates(
      draft.scheduledAt,
      recurrence.recurrenceCount,
    );
    const messageIds = [];
    for (let occurrence = 1; occurrence <= recurrence.recurrenceCount; occurrence += 1) {
      const scheduledAt = occurrenceDates[occurrence - 1];
      const inserted = await client.query(`
        INSERT INTO business_messages (
          content, scheduled_at, idempotency_key,
          media_path, media_mime_type, media_original_name,
          series_id, recurrence_type, occurrence_number, occurrence_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, status
      `, [
        draft.content, scheduledAt, crypto.randomUUID(),
        savedMedia?.filePath ?? null, savedMedia?.mimeType ?? null,
        savedMedia?.originalName ?? null, seriesId,
        recurrence.recurrenceType, occurrence, recurrence.recurrenceCount,
      ]);
      const messageId = inserted.rows[0].id;
      messageIds.push(messageId);
      for (const groupId of draft.groupIds) {
        await client.query(`
          INSERT INTO business_deliveries (message_id, group_id) VALUES ($1, $2)
        `, [messageId, groupId]);
      }
    }
    await client.query('COMMIT');
    return reply.code(201).send({
      id: messageIds[0], messageIds, status: 'draft', seriesId,
      recurrenceType: recurrence.recurrenceType,
      recurrenceCount: recurrence.recurrenceCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (savedMedia?.filePath) await removeMedia(savedMedia.filePath);
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/messages/:id/confirm-series', async (request, reply) => {
  const id = Number(request.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const series = await client.query(`
      SELECT series_id FROM business_messages WHERE id = $1 AND series_id IS NOT NULL
    `, [id]);
    if (!series.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'Série semanal não encontrada' });
    }
    const confirmed = await client.query(`
      UPDATE business_messages
      SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
      WHERE series_id = $1 AND status = 'draft' AND scheduled_at > NOW()
      RETURNING id
    `, [series.rows[0].series_id]);
    if (!confirmed.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'A série não possui ocorrências futuras para confirmar' });
    }
    await client.query(`
      UPDATE business_deliveries d
      SET next_attempt_at = m.scheduled_at, updated_at = NOW()
      FROM business_messages m
      WHERE d.message_id = m.id AND m.series_id = $1
        AND m.status = 'confirmed' AND d.status = 'pending'
    `, [series.rows[0].series_id]);
    await client.query('COMMIT');
    return {
      status: 'confirmed', seriesId: series.rows[0].series_id,
      confirmedCount: confirmed.rowCount, sendingEnabled,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/messages/:id/confirm', async (request, reply) => {
  const id = Number(request.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE business_messages SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'draft' AND scheduled_at > NOW() RETURNING id, scheduled_at
    `, [id]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'Rascunho inexistente, expirado ou já processado' });
    }
    await client.query(`
      UPDATE business_deliveries SET next_attempt_at = $2, updated_at = NOW()
      WHERE message_id = $1 AND status = 'pending'
    `, [id, result.rows[0].scheduled_at]);
    await client.query('COMMIT');
    return { status: 'confirmed', id, sendingEnabled };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/messages/:id/cancel', async (request, reply) => {
  const id = Number(request.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE business_messages SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status IN ('draft','confirmed') RETURNING id
    `, [id]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'Agendamento não pode mais ser cancelado' });
    }
    await client.query(`
      UPDATE business_deliveries SET status = 'cancelled', updated_at = NOW()
      WHERE message_id = $1 AND status = 'pending'
    `, [id]);
    await client.query('COMMIT');
    return { status: 'cancelled', id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/messages/:id/cancel-series', async (request, reply) => {
  const id = Number(request.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const series = await client.query(`
      SELECT series_id FROM business_messages WHERE id = $1 AND series_id IS NOT NULL
    `, [id]);
    if (!series.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'Série semanal não encontrada' });
    }
    const cancelled = await client.query(`
      UPDATE business_messages
      SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE series_id = $1 AND status IN ('draft','confirmed')
      RETURNING id
    `, [series.rows[0].series_id]);
    await client.query(`
      UPDATE business_deliveries d SET status = 'cancelled', updated_at = NOW()
      FROM business_messages m
      WHERE d.message_id = m.id AND m.series_id = $1 AND d.status = 'pending'
    `, [series.rows[0].series_id]);
    await client.query('COMMIT');
    return { status: 'cancelled', cancelledCount: cancelled.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.warn({ error: error.message }, 'Operação recusada');
  reply.code(400).send({ error: error.message });
});

const stopDeliveryWorker = sendingEnabled
  ? startDeliveryWorker({
      pool,
      sendMessage: async delivery => {
        if (!delivery.mediaPath) {
          return sendTextMessage(instanceName, delivery.groupJid, delivery.content);
        }
        const mediaBase64 = await readMediaBase64(delivery.mediaPath);
        return sendImageMessage(
          instanceName,
          delivery.groupJid,
          delivery.content,
          mediaBase64,
          delivery.mediaMimeType,
          delivery.mediaOriginalName,
        );
      },
      logger: app.log,
      intervalMs: workerIntervalMs,
    })
  : () => {};

const shutdown = async () => {
  stopDeliveryWorker();
  await app.close();
  await pool.end();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3010) });
