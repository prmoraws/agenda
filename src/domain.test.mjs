import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDraft, validateGroup } from './domain.mjs';

test('aceita grupo WhatsApp válido', () => {
  assert.deepEqual(validateGroup({ groupJid: '120363000000@g.us', displayName: 'Grupo teste' }), {
    groupJid: '120363000000@g.us', displayName: 'Grupo teste',
  });
});

test('recusa conversa individual', () => {
  assert.throws(() => validateGroup({ groupJid: '557199999999@s.whatsapp.net', displayName: 'Pessoa' }), /JID/);
});

test('normaliza destinatários sem duplicar', () => {
  const result = validateDraft({
    content: 'Mensagem de teste',
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    groupIds: [1, 1, '2'],
  });
  assert.deepEqual(result.groupIds, [1, 2]);
});
