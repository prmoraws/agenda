import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaLimits, validateMediaInput } from './media-storage.mjs';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64');

test('aceita PNG verdadeiro', () => {
  const media = validateMediaInput({ mimeType: 'image/png', fileName: '../foto.png', base64: png });
  assert.equal(media.mimeType, 'image/png');
  assert.equal(media.originalName, 'foto.png');
});

test('recusa extensão declarada com conteúdo diferente', () => {
  assert.throws(() => validateMediaInput({ mimeType: 'image/jpeg', base64: png }), /não corresponde/);
});

test('limita formatos e tamanho', () => {
  assert.deepEqual(mediaLimits.allowedMimeTypes, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(mediaLimits.maximumBytes, 5 * 1024 * 1024);
});
