import assert from 'node:assert/strict';
import test from 'node:test';
import { findInstance, normalizeGroups, normalizeInviteGroup, normalizeLabels } from './evolution.mjs';

test('localiza instância sem depender do formato de resposta', () => {
  assert.equal(findInstance([{ instance: { instanceName: 'agenda' } }], 'agenda').instance.instanceName, 'agenda');
});

test('normaliza grupo consultado por convite', () => {
  assert.deepEqual(normalizeInviteGroup({ group:{ subject:'UNP ABRAÃO', id:'557191191233-1515362953@g.us' } }), {
    displayName:'UNP ABRAÃO', groupJid:'557191191233-1515362953@g.us',
  });
});

test('normaliza somente grupos válidos', () => {
  assert.deepEqual(normalizeGroups([
    { id: '120363001@g.us', subject: 'Grupo A' },
    { id: '557199@s.whatsapp.net', subject: 'Contato' },
  ]), [{
    groupJid: '120363001@g.us', displayName: 'Grupo A', groupKind: 'group',
    communityJid: null, sendable: true,
  }]);
});

test('classifica comunidade, avisos e subgrupo', () => {
  const groups = normalizeGroups([
    { id: '120363001@g.us', subject: 'Comunidade', isCommunity: true },
    { id: '120363002@g.us', subject: 'Avisos', isCommunityAnnounce: true },
    { id: '120363003@g.us', subject: 'Equipe', linkedParent: '120363001@g.us' },
  ]);
  assert.deepEqual(groups.map(group => [group.groupKind, group.sendable]), [
    ['community', false], ['community_announcement', true], ['community_subgroup', true],
  ]);
});

test('normaliza catálogo de etiquetas da Evolution', () => {
  assert.deepEqual(normalizeLabels({ data: [
    { id: '31', name: 'Cursos', color: '#16745D' },
    { id: '', name: 'Inválida' },
  ] }), [{ externalId: '31', name: 'Cursos', color: '#16745d' }]);
});
