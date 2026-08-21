import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import pg from 'pg';
import { validateDraft, validateGroup } from './domain.mjs';
import {
  connectInstance, createInstance, fetchGroups, fetchInstances,
  findInstance, normalizeGroups,
} from './evolution.mjs';

const app = Fastify({ logger: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const instanceName = process.env.DOMO_BUSINESS_INSTANCE_NAME ?? 'domo-business-agendamentos';
const publicRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
let groupImportInProgress = false;

await app.register(fastifyStatic, { root: publicRoot });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { status: 'ok', service: 'agenda', sendingEnabled: false };
});

app.get('/api/whatsapp/status', async () => {
  const payload = await fetchInstances();
  const instance = findInstance(payload, instanceName);
  return {
    instanceName,
    exists: Boolean(instance),
    state: instance?.connectionStatus ?? instance?.instance?.state ?? instance?.state ?? 'not_created',
    sendingEnabled: false,
  };
});

app.post('/api/whatsapp/instance', async () => {
  const existing = findInstance(await fetchInstances(), instanceName);
  if (existing) return { status: 'already_exists', instanceName, sendingEnabled: false };
  await createInstance(instanceName);
  return { status: 'created', instanceName, sendingEnabled: false };
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
    SELECT id, group_jid AS "groupJid", display_name AS "displayName",
      group_kind AS "groupKind", community_jid AS "communityJid", sendable,
      authorized, active, confirmed_at AS "confirmedAt"
    FROM business_groups ORDER BY display_name
  `);
  return rows;
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

app.post('/api/groups/:id/authorize', async (request, reply) => {
  const id = Number(request.params.id);
  const { rows } = await pool.query(`
    UPDATE business_groups SET authorized = TRUE, confirmed_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND active = TRUE AND sendable = TRUE RETURNING id
  `, [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Grupo não encontrado' });
  return { status: 'authorized', id };
});

app.get('/api/messages', async () => {
  const { rows } = await pool.query(`
    SELECT m.id, m.content, m.scheduled_at AS "scheduledAt", m.status,
      m.confirmed_at AS "confirmedAt", m.cancelled_at AS "cancelledAt",
      COUNT(d.id)::int AS "groupCount"
    FROM business_messages m
    LEFT JOIN business_deliveries d ON d.message_id = m.id
    WHERE m.status <> 'deleted'
    GROUP BY m.id ORDER BY m.created_at DESC LIMIT 100
  `);
  return rows;
});

app.get('/api/messages/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const message = await pool.query(`
    SELECT id, content, scheduled_at AS "scheduledAt", timezone, status,
      confirmed_at AS "confirmedAt", cancelled_at AS "cancelledAt",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM business_messages WHERE id = $1 AND status <> 'deleted'
  `, [id]);
  if (!message.rowCount) return reply.code(404).send({ error: 'Agendamento não encontrado' });
  const deliveries = await pool.query(`
    SELECT d.id, d.status, d.attempt_count AS "attemptCount",
      d.max_attempts AS "maxAttempts", d.sent_at AS "sentAt",
      g.id AS "groupId", g.display_name AS "groupName", g.group_jid AS "groupJid"
    FROM business_deliveries d
    JOIN business_groups g ON g.id = d.group_id
    WHERE d.message_id = $1 ORDER BY g.display_name, g.group_jid
  `, [id]);
  return { ...message.rows[0], deliveries: deliveries.rows };
});

app.put('/api/messages/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const draft = validateDraft(request.body ?? {});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`
      SELECT id FROM business_messages
      WHERE id = $1 AND status IN ('draft','confirmed') FOR UPDATE
    `, [id]);
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'Este agendamento não pode mais ser editado' });
    }
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
        status = 'draft', confirmed_at = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id, draft.content, draft.scheduledAt]);
    await client.query('DELETE FROM business_deliveries WHERE message_id = $1', [id]);
    for (const groupId of draft.groupIds) {
      await client.query(`
        INSERT INTO business_deliveries (message_id, group_id) VALUES ($1, $2)
      `, [id, groupId]);
    }
    await client.query('COMMIT');
    return { id, status: 'draft', requiresConfirmation: true };
  } catch (error) {
    await client.query('ROLLBACK');
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
      WHERE id = $1 AND status IN ('draft','confirmed','cancelled') RETURNING id
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const groups = await client.query(`
      SELECT id FROM business_groups
      WHERE id = ANY($1::bigint[]) AND active = TRUE
        AND authorized = TRUE AND sendable = TRUE
    `, [draft.groupIds]);
    if (groups.rowCount !== draft.groupIds.length) throw new Error('Há grupo inexistente ou ainda não autorizado');
    const inserted = await client.query(`
      INSERT INTO business_messages (content, scheduled_at, idempotency_key)
      VALUES ($1, $2, $3) RETURNING id, status
    `, [draft.content, draft.scheduledAt, crypto.randomUUID()]);
    const messageId = inserted.rows[0].id;
    for (const groupId of draft.groupIds) {
      await client.query(`
        INSERT INTO business_deliveries (message_id, group_id) VALUES ($1, $2)
      `, [messageId, groupId]);
    }
    await client.query('COMMIT');
    return reply.code(201).send({ id: messageId, status: 'draft' });
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
    return { status: 'confirmed', id, sendingEnabled: false };
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

app.setErrorHandler((error, _request, reply) => {
  app.log.warn({ error: error.message }, 'Operação recusada');
  reply.code(400).send({ error: error.message });
});

const shutdown = async () => { await app.close(); await pool.end(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3010) });
