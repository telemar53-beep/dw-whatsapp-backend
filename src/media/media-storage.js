const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('../config/env');

const EXTENSION_BY_MIME_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'audio/ogg': '.ogg',
  'audio/ogg; codecs=opus': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
};

function extensionForMimeType(mimeType) {
  if (!mimeType) return '';
  const base = mimeType.split(';')[0].trim();
  return EXTENSION_BY_MIME_TYPE[mimeType] || EXTENSION_BY_MIME_TYPE[base] || '';
}

function messageTypeForMimeType(mimeType) {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

async function saveMediaFile(buffer, extension) {
  const dir = path.resolve(loadConfig().mediaStorageDir);
  await fs.promises.mkdir(dir, { recursive: true });
  const relativePath = `${crypto.randomUUID()}${extension || ''}`;
  await fs.promises.writeFile(path.join(dir, relativePath), buffer);
  return relativePath;
}

function getMediaFilePath(relativePath) {
  const baseDir = path.resolve(loadConfig().mediaStorageDir);
  const fullPath = path.resolve(baseDir, relativePath);
  if (!fullPath.startsWith(baseDir + path.sep) && fullPath !== baseDir) {
    throw new Error('Invalid media path');
  }
  return fullPath;
}

// Remove um arquivo de mídia já substituído (ex.: foto antiga de um contato).
// Arquivo inexistente não é erro — o objetivo é só não acumular lixo em disco.
async function deleteMediaFile(relativePath) {
  if (!relativePath) return;
  await fs.promises.rm(getMediaFilePath(relativePath), { force: true });
}

module.exports = { saveMediaFile, deleteMediaFile, getMediaFilePath, extensionForMimeType, messageTypeForMimeType };
