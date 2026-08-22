import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOccurrenceDates, extractWhatsappInviteCode, parseWhatsappInviteLinks,
  validateDraft, validateGroup, validateLabel, validateMessageTemplate, validateRecurrence,
} from './domain.mjs';

test('aceita grupo WhatsApp válido', () => {
  assert.deepEqual(validateGroup({ groupJid: '120363000000@g.us', displayName: 'Grupo teste' }), {
    groupJid: '120363000000@g.us', displayName: 'Grupo teste',
  });
});

test('extrai código de link oficial de convite', () => {
  assert.equal(
    extractWhatsappInviteCode('https://chat.whatsapp.com/HLt4g3at8Qz7c48iJ5lUYY?mode=ac_t'),
    'HLt4g3at8Qz7c48iJ5lUYY',
  );
  assert.throws(() => extractWhatsappInviteCode('https://site-invalido.test/codigo123456'), /oficial/);
});

test('separa e elimina links de convite repetidos', () => {
  assert.deepEqual(parseWhatsappInviteLinks('https://chat.whatsapp.com/AAA111bbb222\nhttps://chat.whatsapp.com/CCC333ddd444\nhttps://chat.whatsapp.com/AAA111bbb222'), [
    'https://chat.whatsapp.com/AAA111bbb222',
    'https://chat.whatsapp.com/CCC333ddd444',
  ]);
});

test('recusa conversa individual', () => {
  assert.throws(() => validateGroup({ groupJid: '557199999999@s.whatsapp.net', displayName: 'Pessoa' }), /JID/);
});

test('aceita JID legado de grupo com hífen', () => {
  const group = validateGroup({
    groupJid: '557191191233-1515362953@g.us',
    displayName: 'Grupo legado',
  });
  assert.equal(group.groupJid, '557191191233-1515362953@g.us');
});

test('normaliza destinatários sem duplicar', () => {
  const result = validateDraft({
    content: 'Mensagem de teste',
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    groupIds: [1, 1, '2'],
  });
  assert.deepEqual(result.groupIds, [1, 2]);
});

test('aceita série semanal limitada', () => {
  assert.deepEqual(validateRecurrence({ recurrenceType: 'weekly', recurrenceCount: 4 }), {
    recurrenceType: 'weekly', recurrenceCount: 4,
  });
});

test('recusa série semanal excessiva', () => {
  assert.throws(
    () => validateRecurrence({ recurrenceType: 'weekly', recurrenceCount: 53 }),
    /entre 2 e 52/,
  );
});

test('gera ocorrências separadas por sete dias', () => {
  assert.deepEqual(buildOccurrenceDates('2026-08-24T15:00:00.000Z', 3), [
    '2026-08-24T15:00:00.000Z',
    '2026-08-31T15:00:00.000Z',
    '2026-09-07T15:00:00.000Z',
  ]);
});

test('valida nome e cor da etiqueta', () => {
  assert.deepEqual(validateLabel({ name: '  Cursos  ', color: '#16745D' }), {
    name: 'Cursos', color: '#16745d',
  });
  assert.throws(() => validateLabel({ name: 'X', color: 'verde' }), /etiqueta/);
});

test('valida modelo reutilizável de mensagem', () => {
  assert.deepEqual(validateMessageTemplate({ name:'  Reunião semanal ', content:'  Reunião às 15h. ' }), {
    name:'Reunião semanal', content:'Reunião às 15h.',
  });
  assert.throws(() => validateMessageTemplate({ name:'X', content:'' }), /modelo/);
});
