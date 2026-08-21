import assert from 'node:assert/strict';
import test from 'node:test';
import { findInstance, normalizeGroups } from './evolution.mjs';

test('localiza instância sem depender do formato de resposta', () => {
  assert.equal(findInstance([{ instance: { instanceName: 'agenda' } }], 'agenda').instance.instanceName, 'agenda');
});

test('normaliza somente grupos válidos', () => {
  assert.deepEqual(normalizeGroups([
    { id: '120363001@g.us', subject: 'Grupo A' },
    { id: '557199@s.whatsapp.net', subject: 'Contato' },
  ]), [{ groupJid: '120363001@g.us', displayName: 'Grupo A' }]);
});
