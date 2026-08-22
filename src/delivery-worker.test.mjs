import assert from 'node:assert/strict';
import test from 'node:test';
import { processOneDelivery, retryDelayMinutes, sanitizeErrorCode } from './delivery-worker.mjs';

test('classifica falhas sem guardar mensagem sensível', () => {
  assert.equal(sanitizeErrorCode(new Error('HTTP 429 rate-overlimit')), 'RATE_LIMIT');
  assert.equal(sanitizeErrorCode(new Error('operation aborted due to timeout')), 'TIMEOUT');
});

test('aplica retentativas progressivas e limitadas', () => {
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMinutes), [1, 5, 15, 15]);
});

test('entrega foto e legenda ao adaptador do provedor', async () => {
  let received;
  const pool = {
    query: async sql => {
      if (sql.includes('WITH candidate')) return { rows: [{
        id: 9, messageId: 4, attemptCount: 1, maxAttempts: 3,
        content: 'Legenda', groupJid: '120363000@g.us',
        mediaPath: '/app/data/uploads/foto.jpg', mediaMimeType: 'image/jpeg',
        mediaOriginalName: 'foto.jpg',
      }] };
      if (sql.includes("COUNT(*) FILTER (WHERE status = 'sent')")) {
        return { rows: [{ sent: 1, active: 0, retryable: 0, exhausted: 0 }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const processed = await processOneDelivery({
    pool,
    sendMessage: async delivery => { received = delivery; return { key: { id: 'provider-1' } }; },
    logger: { warn() {} },
  });
  assert.equal(processed, true);
  assert.equal(received.content, 'Legenda');
  assert.equal(received.mediaOriginalName, 'foto.jpg');
});
