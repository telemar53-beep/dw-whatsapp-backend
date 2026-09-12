const fs = require('fs');
const path = require('path');
const { getAiConfig } = require('./ai-config.repository');
const { transcribeAudio } = require('./openai-client');
const {
  findMessageById,
  markTranscriptionProcessing,
  saveTranscription,
  markTranscriptionFailed,
} = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');
const { mensagemSegura } = require('./safe-error-log');

// O WhatsApp manda nota de voz como 'audio/ogg; codecs=opus' — o parâmetro depois
// do ';' faz parte do cabeçalho e precisa ser cortado antes de comparar.
const MIME_ACEITOS = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm'];

function mimeAceito(mimeType) {
  if (!mimeType) return false;
  return MIME_ACEITOS.includes(mimeType.split(';')[0].trim().toLowerCase());
}

function recusa(motivo) {
  return { ok: false, motivo };
}

/**
 * Transcreve o áudio de uma mensagem já persistida. O arquivo NÃO é temporário:
 * é o mesmo que o player do atendente usa, então nunca é apagado aqui.
 */
async function transcribeMessage(messageId) {
  const message = await findMessageById(messageId);
  if (!message || message.messageType !== 'audio') return recusa('not_audio');
  if (!message.mediaPath) {
    await markTranscriptionFailed(messageId, { status: 'failed', detail: 'mensagem de áudio sem arquivo', ms: null });
    return recusa('no_media');
  }

  if (!mimeAceito(message.mediaMimeType)) {
    await markTranscriptionFailed(messageId, {
      status: 'skipped', detail: 'formato de áudio não suportado', ms: null,
    });
    return recusa('unsupported_mime');
  }

  const config = await getAiConfig();
  if (!config) {
    await markTranscriptionFailed(messageId, { status: 'failed', detail: 'configuração de IA ausente', ms: null });
    return recusa('disabled');
  }
  const iniciadoEm = Date.now();

  // Trava de desligamento: o gate em shouldTranscribe roda no enfileiramento, e
  // um job já na fila quando o admin desliga chegaria aqui e gastaria uma
  // chamada paga à OpenAI depois de desligada. Este é o ponto único por onde
  // toda transcrição passa.
  if (!config.transcriptionEnabled) {
    await markTranscriptionFailed(messageId, { status: 'skipped', detail: 'transcrição desativada', ms: null });
    return recusa('disabled');
  }

  // Limite de duração: só aplica quando o metadado do WhatsApp trouxe o valor.
  if (message.audioDurationSeconds && message.audioDurationSeconds > config.transcriptionMaxSeconds) {
    await markTranscriptionFailed(messageId, {
      status: 'skipped',
      detail: `áudio de ${message.audioDurationSeconds}s acima do limite de ${config.transcriptionMaxSeconds}s`,
      ms: null,
    });
    return recusa('too_long');
  }

  // getMediaFilePath LANÇA em caminho suspeito (proteção contra path traversal).
  // Sem este try/catch a mensagem ficaria 'pending' para sempre e a tela mostraria
  // "Transcrevendo…" eternamente.
  let filePath;
  let stats;
  try {
    filePath = getMediaFilePath(message.mediaPath);
    stats = await fs.promises.stat(filePath);
  } catch (err) {
    await markTranscriptionFailed(messageId, { status: 'failed', detail: 'arquivo de áudio não encontrado', ms: null });
    return recusa('no_media');
  }

  if (stats.size > config.transcriptionMaxBytes) {
    await markTranscriptionFailed(messageId, {
      status: 'skipped',
      detail: `arquivo de ${stats.size} bytes acima do limite de ${config.transcriptionMaxBytes}`,
      ms: null,
    });
    return recusa('too_large');
  }

  await markTranscriptionProcessing(messageId);

  let resultado;
  try {
    // O nome do arquivo manda na OpenAI, não o contentType (ver openai-client.js):
    // mantém a extensão real que extensionForMimeType gravou em disco, senão
    // mp4/aac/wav/webm chegam como 'audio.ogg' e a API rejeita o decode.
    const extensao = path.extname(message.mediaPath);
    resultado = await transcribeAudio({
      apiKey: config.apiKey,
      model: config.transcriptionModel,
      filePath,
      mimeType: message.mediaMimeType,
      prompt: config.transcriptionPrompt || undefined,
      filename: 'audio' + (extensao || '.ogg'),
    });
  } catch (err) {
    console.error(`Transcription failed for message ${messageId}: ${mensagemSegura(err)}`);
    await markTranscriptionFailed(messageId, {
      status: 'failed', detail: mensagemSegura(err), ms: Date.now() - iniciadoEm,
    });
    return recusa('transcription_failed');
  }

  const texto = (resultado.texto || '').trim();
  if (!texto) {
    // Texto vazio não vira transcrição vazia: a IA jamais deve receber conteúdo
    // em branco e responder como se tivesse entendido algo.
    await markTranscriptionFailed(messageId, {
      status: 'failed', detail: 'transcrição vazia', ms: Date.now() - iniciadoEm,
    });
    return recusa('transcription_failed');
  }

  await saveTranscription(messageId, {
    transcription: texto,
    model: config.transcriptionModel,
    ms: Date.now() - iniciadoEm,
  });
  return { ok: true, transcription: texto };
}

module.exports = { transcribeMessage };
