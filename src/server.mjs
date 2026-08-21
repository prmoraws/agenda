import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import pg from 'pg';
import { validateDraft, validateGroup } from './domain.mjs';

const app = Fastify({ logger: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const instanceName = process.env.DOMO_BUSINESS_INSTANCE_NAME ?? 'domo-business-agendamentos';
const publicRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

await app.register(fastifyStatic, { root: publicRoot });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { status: 'ok', service: 'agenda', sendingEnabled: false };
});

app.get('/api/groups', async () => {
  const { rows } = await pool.query(`
    SELECT id, group_jid AS "groupJid", display_name AS "displayName",
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
    WHERE id = $1 AND active = TRUE RETURNING id
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
    GROUP BY m.id ORDER BY m.created_at DESC LIMIT 100
  `);
  return rows;
});

app.post('/api/messages', async (request, reply) => {
  const draft = validateDraft(request.body ?? {});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const groups = await client.query(`
      SELECT id FROM business_groups
      WHERE id = ANY($1::bigint[]) AND active = TRUE AND authorized = TRUE
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
