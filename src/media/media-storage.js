const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('../config/env');
const { compressInboundImage } = require('./image-compressor');

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

// Ponto unico por onde a midia RECEBIDA entra no disco: comprime a imagem
// antes de gravar. Centralizado de proposito — os tres canais salvavam cada um
// do seu jeito, e uma otimizacao aplicada em dois de tres nao economiza nada.
async function saveInboundMedia(buffer, mimeType) {
  const comprimido = await compressInboundImage(buffer, mimeType);
  const mediaPath = await saveMediaFile(comprimido.buffer, extensionForMimeType(comprimido.mimeType));
  return { mediaPath, mediaMimeType: comprimido.mimeType };
}

// Avatar tem outra escala, e por isso não usa os mesmos números da mídia
// recebida. Medido em produção em 23/09/2026: UM avatar de 3.701 kB respondia
// por praticamente todo o tráfego de uma sessão — e o maior uso de avatar em
// toda a aplicação é 68px. Mesmo a 3x de densidade de tela, 256px cobre com
// folga; 1600px (o valor da mídia recebida) continuaria sendo ~25x mais imagem
// do que a tela usa.
//
// O limiar também cai: um avatar de 200 kB passava batido pelos 300 kB da mídia
// recebida e continuava sendo 20x maior que o necessário.
//
// Ponto único de propósito: os dois caminhos que gravam avatar — upload do
// atendente e foto de perfil do contato — passavam direto por saveMediaFile,
// sem compressão nenhuma, enquanto a mídia recebida já comprimia havia dias.
// Uma otimização aplicada em dois de três lugares não economiza nada.
const AVATAR_LADO_MAIOR = 256;
const AVATAR_LIMIAR_BYTES = 24 * 1024;

async function saveAvatarImage(buffer, mimeType) {
  const comprimido = await compressInboundImage(buffer, mimeType, {
    ladoMaior: AVATAR_LADO_MAIOR,
    limiarBytes: AVATAR_LIMIAR_BYTES,
  });
  // Extensão do resultado, com a do original como reserva: um mimeType que o
  // mapa não conhece gravaria arquivo sem extensão, e aí o sendFile serviria
  // sem Content-Type. Nunca pior do que era antes.
  const extensao = extensionForMimeType(comprimido.mimeType) || extensionForMimeType(mimeType);
  const avatarPath = await saveMediaFile(comprimido.buffer, extensao);
  return { avatarPath, mimeType: comprimido.mimeType };
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

module.exports = {
  saveMediaFile,
  saveInboundMedia,
  saveAvatarImage,
  deleteMediaFile,
  getMediaFilePath,
  extensionForMimeType,
  messageTypeForMimeType,
  AVATAR_LADO_MAIOR,
  AVATAR_LIMIAR_BYTES,
};
