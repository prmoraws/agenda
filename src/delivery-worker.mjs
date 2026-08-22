const retryDelaysMinutes = [1, 5, 15];
const staleLockMinutes = 5;

export const sanitizeErrorCode = error => {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|rate.overlimit/i.test(message)) return 'RATE_LIMIT';
  if (/timeout|aborted/i.test(message)) return 'TIMEOUT';
  if (/not.?found|does not exist/i.test(message)) return 'DESTINATION_NOT_FOUND';
  if (/not.?authorized|forbidden|401|403/i.test(message)) return 'AUTHORIZATION';
  return 'PROVIDER_ERROR';
};

export const retryDelayMinutes = attemptCount =>
  retryDelaysMinutes[Math.min(Math.max(attemptCount - 1, 0), retryDelaysMinutes.length - 1)];

const finalizeMessage = async (pool, messageId) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status IN ('pending','processing'))::int AS active,
      COUNT(*) FILTER (WHERE status = 'failed' AND attempt_count < max_attempts)::int AS retryable,
      COUNT(*) FILTER (WHERE status = 'failed' AND attempt_count >= max_attempts)::int AS exhausted
    FROM business_deliveries WHERE message_id = $1
  `, [messageId]);
  const totals = rows[0];
  let status = 'processing';
  if (totals.active === 0 && totals.retryable === 0) {
    status = totals.exhausted === 0
      ? 'completed'
      : totals.sent > 0 ? 'partial_failed' : 'failed';
  }
  await pool.query(`
    UPDATE business_messages SET status = $2, updated_at = NOW()
    WHERE id = $1 AND status NOT IN ('cancelled','deleted')
  `, [messageId, status]);
};

const claimDelivery = async pool => {
  const { rows } = await pool.query(`
    WITH candidate AS (
      SELECT d.id
      FROM business_deliveries d
      JOIN business_messages m ON m.id = d.message_id
      JOIN business_groups g ON g.id = d.group_id
      WHERE m.status IN ('confirmed','processing')
        AND m.scheduled_at <= NOW()
        AND d.status IN ('pending','failed')
        AND d.attempt_count < d.max_attempts
        AND COALESCE(d.next_attempt_at, m.scheduled_at) <= NOW()
        AND g.active = TRUE AND g.authorized = TRUE AND g.sendable = TRUE
      ORDER BY COALESCE(d.next_attempt_at, m.scheduled_at), d.id
      FOR UPDATE OF d SKIP LOCKED
      LIMIT 1
    )
    UPDATE business_deliveries d
    SET status = 'processing', attempt_count = attempt_count + 1,
      locked_at = NOW(), updated_at = NOW()
    FROM candidate c, business_messages m, business_groups g
    WHERE d.id = c.id AND m.id = d.message_id AND g.id = d.group_id
    RETURNING d.id, d.message_id AS "messageId", d.attempt_count AS "attemptCount",
      d.max_attempts AS "maxAttempts", m.content, g.group_jid AS "groupJid",
      m.media_path AS "mediaPath", m.media_mime_type AS "mediaMimeType",
      m.media_original_name AS "mediaOriginalName"
  `);
  return rows[0] ?? null;
};

const releaseStaleDeliveries = async pool => {
  await pool.query(`
    UPDATE business_deliveries
    SET status = 'failed', error_code = 'WORKER_INTERRUPTED',
      next_attempt_at = NOW(), updated_at = NOW()
    WHERE status = 'processing'
      AND locked_at < NOW() - ($1 * INTERVAL '1 minute')
      AND attempt_count < max_attempts
  `, [staleLockMinutes]);
};

export const processOneDelivery = async ({ pool, sendMessage, logger }) => {
  const delivery = await claimDelivery(pool);
  if (!delivery) return false;
  await pool.query(`
    UPDATE business_messages SET status = 'processing', updated_at = NOW()
    WHERE id = $1 AND status = 'confirmed'
  `, [delivery.messageId]);
  try {
    const result = await sendMessage(delivery);
    const providerId = result?.key?.id ?? result?.message?.key?.id ?? null;
    await pool.query(`
      UPDATE business_deliveries SET status = 'sent', evolution_message_id = $2,
        error_code = NULL, sent_at = NOW(), next_attempt_at = NULL, updated_at = NOW()
      WHERE id = $1
    `, [delivery.id, providerId]);
    await pool.query(`
      INSERT INTO business_events (message_id, delivery_id, event_type, outcome)
      VALUES ($1, $2, 'delivery_sent', 'ok')
    `, [delivery.messageId, delivery.id]);
  } catch (error) {
    const code = sanitizeErrorCode(error);
    const delay = retryDelayMinutes(delivery.attemptCount);
    await pool.query(`
      UPDATE business_deliveries SET status = 'failed', error_code = $2,
        next_attempt_at = CASE WHEN attempt_count < max_attempts
          THEN NOW() + ($3 * INTERVAL '1 minute') ELSE NULL END,
        updated_at = NOW()
      WHERE id = $1
    `, [delivery.id, code, delay]);
    await pool.query(`
      INSERT INTO business_events (message_id, delivery_id, event_type, outcome, error_code)
      VALUES ($1, $2, 'delivery_failed', 'error', $3)
    `, [delivery.messageId, delivery.id, code]);
    logger.warn({ deliveryId: delivery.id, errorCode: code }, 'Entrega recusada pelo provedor');
  }
  await finalizeMessage(pool, delivery.messageId);
  return true;
};

export const startDeliveryWorker = ({ pool, sendMessage, logger, intervalMs }) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await releaseStaleDeliveries(pool);
      while (await processOneDelivery({ pool, sendMessage, logger })) { /* esvazia vencidos */ }
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Falha no executor');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
};
