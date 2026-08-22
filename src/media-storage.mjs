import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const storageRoot = process.env.MEDIA_STORAGE_PATH ?? '/app/data/uploads';
const maximumBytes = 5 * 1024 * 1024;
const allowedTypes = new Map([
  ['image/jpeg', { extension: '.jpg', matches: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/png', { extension: '.png', matches: buffer => buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) }],
  ['image/webp', { extension: '.webp', matches: buffer => buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' }],
]);

const decodeBase64 = value => {
  const raw = String(value ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error('Imagem inválida');
  return Buffer.from(raw, 'base64');
};

export const validateMediaInput = input => {
  if (!input || typeof input !== 'object') return null;
  const mimeType = String(input.mimeType ?? '').toLowerCase();
  const type = allowedTypes.get(mimeType);
  if (!type) throw new Error('Formato não permitido. Use JPG, PNG ou WEBP');
  const buffer = decodeBase64(input.base64);
  if (!buffer.length || buffer.length > maximumBytes) throw new Error('A foto deve ter no máximo 5 MB');
  if (!type.matches(buffer)) throw new Error('O conteúdo da foto não corresponde ao formato informado');
  const suppliedName = path.basename(String(input.fileName ?? '').trim()).slice(0, 200);
  const originalName = suppliedName || `foto${type.extension}`;
  return { buffer, mimeType, originalName, extension: type.extension };
};

export const saveMedia = async media => {
  if (!media) return null;
  await fs.mkdir(storageRoot, { recursive: true });
  const fileName = `${crypto.randomUUID()}${media.extension}`;
  const filePath = path.join(storageRoot, fileName);
  await fs.writeFile(filePath, media.buffer, { mode: 0o600 });
  return { filePath, mimeType: media.mimeType, originalName: media.originalName };
};

export const readMediaBase64 = async filePath => {
  const resolved = path.resolve(filePath);
  const root = `${path.resolve(storageRoot)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('Caminho de mídia recusado');
  return (await fs.readFile(resolved)).toString('base64');
};

export const removeMedia = async filePath => {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const root = `${path.resolve(storageRoot)}${path.sep}`;
  if (!resolved.startsWith(root)) return;
  await fs.rm(resolved, { force: true });
};

export const mediaLimits = { maximumBytes, allowedMimeTypes: [...allowedTypes.keys()] };
