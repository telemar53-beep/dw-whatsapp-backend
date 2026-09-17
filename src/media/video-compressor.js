const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Vídeo recebido é o que mais pesa no disco quando o cliente manda com
// frequência: 3–8 MB por meio minuto, contra 2–4 MB de uma foto.
//
// Diferente da imagem, isto NÃO roda no webhook: transcodificar vídeo leva
// segundos a minutos, e a Meta trata uma resposta lenta como falha e reenvia a
// mensagem. Quem chama é o worker, depois que o original já foi gravado e o
// cliente já viu a mensagem entregue.
//
// O ganho aqui é menor que o da imagem (o WhatsApp já comprime antes de
// enviar), mas 720p com CRF 28 costuma cortar metade sem estragar um vídeo de
// celular — que é sempre a gravação de um problema, não cinema.
const MAX_VIDEO_HEIGHT = 720;
const VIDEO_CRF = '28';
const VIDEO_AUDIO_BITRATE = '64k';
// Abaixo disso não compensa a CPU.
const VIDEO_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;

const COMPRESSIBLE_VIDEO = ['video/mp4', 'video/3gpp', 'video/quicktime'];

function baseMime(mimeType) {
  return String(mimeType || '').split(';')[0].trim();
}

/**
 * Síncrono de propósito: roda dentro do worker, onde bloquear o próprio job é o
 * comportamento desejado — um vídeo por vez, sem disputar CPU com os outros.
 *
 * Devolve `{ buffer, mimeType }` sempre. Qualquer problema (formato ilegível,
 * ffmpeg falhando, resultado maior que o original) devolve o vídeo original: a
 * mensagem do cliente não pode se perder por causa de uma otimização.
 */
function compressVideo(buffer, mimeType) {
  if (!COMPRESSIBLE_VIDEO.includes(baseMime(mimeType))) return { buffer, mimeType };
  if (!buffer || buffer.length < VIDEO_COMPRESSION_THRESHOLD_BYTES) return { buffer, mimeType };

  const resultado = spawnSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      // Só encolhe: `min(ih,MAX)` impede ampliar um vídeo já pequeno, o que
      // aumentaria o arquivo. -2 mantém a proporção em número par de pixels,
      // que o H.264 exige.
      '-vf', `scale=-2:'min(${MAX_VIDEO_HEIGHT},ih)'`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', VIDEO_CRF,
      '-c:a', 'aac',
      '-b:a', VIDEO_AUDIO_BITRATE,
      // O MP4 normal precisa voltar ao início para escrever o índice, o que não
      // dá num pipe. Fragmentado escreve direto, em ordem.
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4',
      'pipe:1',
    ],
    { input: buffer, maxBuffer: 512 * 1024 * 1024 }
  );

  if (resultado.status !== 0 || !resultado.stdout || !resultado.stdout.length) {
    const erro = String(resultado.stderr || '').trim().slice(0, 200);
    console.warn(`Não foi possível comprimir o vídeo recebido: ${erro || `ffmpeg saiu com ${resultado.status}`}`);
    return { buffer, mimeType };
  }
  if (resultado.stdout.length >= buffer.length) return { buffer, mimeType };

  return { buffer: resultado.stdout, mimeType: 'video/mp4' };
}

module.exports = { compressVideo, MAX_VIDEO_HEIGHT, VIDEO_COMPRESSION_THRESHOLD_BYTES };
