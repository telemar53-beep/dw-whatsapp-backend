const ffmpegPath = require('ffmpeg-static');

// Imagem recebida do cliente era gravada exatamente como chegava: uma foto de
// celular ocupa 2–4 MB no disco, e nada nunca é apagado. Medido em produção no
// primeiro dia de uso: ~76 MB/dia, ~2,3 GB/mês.
//
// Um comprovante continua perfeitamente legível com o lado maior em 1600px, e é
// aí que mora quase toda a economia — a resolução de 12 MP do celular não
// acrescenta nada para quem só precisa ler valor, data e favorecido.
//
// Usa o ffmpeg que o projeto já embarca para normalizar áudio: sem dependência
// nova e sem risco de instalação no servidor.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 4; // escala do ffmpeg: 2 é quase sem perda, 31 é o pior
// Abaixo disso não compensa: gasta CPU e às vezes até aumenta o arquivo.
const COMPRESSION_THRESHOLD_BYTES = 300 * 1024;

const COMPRESSIBLE = {
  'image/jpeg': { formato: 'mjpeg', mimeType: 'image/jpeg' },
  'image/png': { formato: 'image2', mimeType: 'image/png' },
  'image/webp': { formato: 'webp', mimeType: 'image/webp' },
};

function baseMime(mimeType) {
  return String(mimeType || '').split(';')[0].trim();
}

function transcode(buffer, formato, ladoMaior) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      // Só encolhe: `min(iw,MAX)` impede que uma imagem pequena seja ampliada,
      // o que aumentaria o arquivo em vez de reduzir. -2 mantém a proporção.
      '-vf', `scale='min(${ladoMaior},iw)':-2`,
      '-q:v', String(JPEG_QUALITY),
      '-frames:v', '1',
      '-f', formato,
      'pipe:1',
    ]);

    const stdout = [];
    const stderr = [];
    ffmpeg.stdout.on('data', (c) => stdout.push(c));
    ffmpeg.stderr.on('data', (c) => stderr.push(c));
    // O ffmpeg fecha stdin assim que rejeita a entrada, e o resto da escrita
    // levanta EPIPE. O código de saída abaixo é o sinal real.
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(stderr).toString().trim() || `ffmpeg saiu com ${code}`));
      resolve(Buffer.concat(stdout));
    });
    ffmpeg.stdin.end(buffer);
  });
}

/**
 * Devolve `{ buffer, mimeType }` — sempre, mesmo quando não comprime. Uma
 * otimização nunca pode custar a mensagem do cliente: qualquer problema aqui
 * (formato que o ffmpeg não lê, bytes corrompidos, resultado maior que o
 * original) devolve o arquivo original intacto.
 */
async function compressInboundImage(
  buffer,
  mimeType,
  // Os dois padrões são exatamente os valores de antes: quem chama sem opções
  // — o caminho da mídia recebida — não muda em um byte. Existem para o avatar,
  // que tem outra escala: um comprovante precisa ser legível, um avatar é
  // pintado em 68px no maior uso da tela. Ver saveAvatarImage.
  { ladoMaior = MAX_DIMENSION, limiarBytes = COMPRESSION_THRESHOLD_BYTES } = {}
) {
  const alvo = COMPRESSIBLE[baseMime(mimeType)];
  if (!alvo || !buffer || buffer.length <= limiarBytes) {
    return { buffer, mimeType };
  }

  try {
    const comprimido = await transcode(buffer, alvo.formato, ladoMaior);
    // Resultado maior que o original acontece (PNG já otimizado, por exemplo):
    // nesse caso o original é que fica.
    if (!comprimido.length || comprimido.length >= buffer.length) return { buffer, mimeType };
    return { buffer: comprimido, mimeType: alvo.mimeType };
  } catch (err) {
    console.warn(`Não foi possível comprimir a imagem recebida (${baseMime(mimeType)}): ${err.message}`);
    return { buffer, mimeType };
  }
}

module.exports = { compressInboundImage, MAX_DIMENSION, COMPRESSION_THRESHOLD_BYTES };
