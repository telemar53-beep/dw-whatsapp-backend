const fs = require('fs');
const { processMediaCompressionQueue } = require('./media-compression-queue');
const { findMessageById, updateMessageMedia } = require('../conversations/message.repository');
const { getMediaFilePath, saveMediaFile, deleteMediaFile, extensionForMimeType } = require('../media/media-storage');
const { compressVideo } = require('../media/video-compressor');
const { mensagemSegura } = require('../ai/safe-error-log');

/**
 * Comprime o vídeo DEPOIS de ele já estar gravado e entregue no chat. Fica fora
 * do webhook porque transcodificar leva segundos a minutos, e a Meta trata uma
 * resposta lenta como falha e reenvia a mensagem.
 *
 * Nunca lança: uma otimização que derruba o worker custa mais do que o disco
 * que ela economiza. Qualquer problema deixa o vídeo original no lugar.
 */
async function handleMediaCompressionJob({ messageId }) {
  try {
    const message = await findMessageById(messageId);
    if (!message || message.messageType !== 'video' || !message.mediaPath) return;

    const original = await fs.promises.readFile(getMediaFilePath(message.mediaPath));
    const { buffer, mimeType } = compressVideo(original, message.mediaMimeType);

    // Sem ganho, o original fica: gravar um arquivo novo do mesmo tamanho só
    // desperdiçaria o disco que estamos tentando economizar.
    if (buffer === original || buffer.length >= original.length) return;

    const novoCaminho = await saveMediaFile(buffer, extensionForMimeType(mimeType));
    const atualizada = await updateMessageMedia(messageId, { mediaPath: novoCaminho, mediaMimeType: mimeType });
    // O original só sai DEPOIS que a mensagem já aponta para o novo. Na ordem
    // inversa, uma falha aqui deixaria a mensagem apontando para um arquivo que
    // não existe mais — o cliente perderia o vídeo.
    if (!atualizada) return;
    await deleteMediaFile(message.mediaPath);
  } catch (err) {
    console.error(`Compressão de vídeo falhou para a mensagem ${messageId}: ${mensagemSegura(err)}`);
  }
}

function startMediaCompressionWorker() {
  processMediaCompressionQueue(handleMediaCompressionJob);
}

module.exports = { handleMediaCompressionJob, startMediaCompressionWorker };
