const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const ffmpegPath = require('ffmpeg-static');
const { compressInboundImage, MAX_DIMENSION, COMPRESSION_THRESHOLD_BYTES } = require('./image-compressor');

const execFileAsync = promisify(execFile);

// Imagem de verdade, gerada pelo ffmpeg do próprio projeto: o teste exercita os
// bytes reais em vez de um substituto que sempre concorda com o código.
async function gerarImagem(size) {
  const { stdout } = await execFileAsync(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `nullsrc=size=${size}`, '-vf', 'geq=random(1)*255:128:128', '-frames:v', '1', '-q:v', '2', '-f', 'mjpeg', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  return stdout;
}

// `execFile` não aceita `input`: quem escreve no stdin é o spawnSync. O ffmpeg
// descreve a entrada no stderr e sai com erro por não ter saída — é daí que vem
// o "LARGURAxALTURA", sem precisar decodificar nada.
function dimensoes(buffer) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', 'pipe:0'], { input: buffer });
  return String(r.stderr || '');
}

function ffmpegConsegueLer(buffer) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-f', 'null', '-'], { input: buffer });
  return r.status === 0;
}

describe('compressInboundImage', () => {
  jest.setTimeout(60000);

  test('reduz uma foto grande, como a que chega de celular', async () => {
    const original = await gerarImagem('3000x2000');

    const { buffer, mimeType } = await compressInboundImage(original, 'image/jpeg');

    expect(buffer.length).toBeLessThan(original.length);
    expect(mimeType).toBe('image/jpeg');
  });

  test('a imagem comprimida continua sendo uma imagem legível', async () => {
    const original = await gerarImagem('3000x2000');

    const { buffer } = await compressInboundImage(original, 'image/jpeg');

    // O ffmpeg só lê o resultado se for um JPEG válido; bytes quebrados falhariam aqui.
    expect(ffmpegConsegueLer(buffer)).toBe(true);
  });

  // Recomprimir o que já é pequeno gasta CPU e às vezes até aumenta o arquivo.
  test('não mexe numa imagem que já é pequena', async () => {
    const pequena = await gerarImagem('200x200');
    expect(pequena.length).toBeLessThan(COMPRESSION_THRESHOLD_BYTES);

    const { buffer } = await compressInboundImage(pequena, 'image/jpeg');

    expect(buffer).toBe(pequena);
  });

  test('não mexe no que não é imagem', async () => {
    const pdf = Buffer.from('%PDF-1.4 conteudo');

    const { buffer, mimeType } = await compressInboundImage(pdf, 'application/pdf');

    expect(buffer).toBe(pdf);
    expect(mimeType).toBe('application/pdf');
  });

  // A mensagem do cliente nunca pode se perder por causa de uma otimização.
  test('bytes que o ffmpeg não lê voltam como vieram', async () => {
    const lixo = Buffer.alloc(COMPRESSION_THRESHOLD_BYTES + 1, 7);

    const { buffer, mimeType } = await compressInboundImage(lixo, 'image/jpeg');

    expect(buffer).toBe(lixo);
    expect(mimeType).toBe('image/jpeg');
  });

  test('limita o lado maior da imagem', async () => {
    const original = await gerarImagem('3000x2000');

    const { buffer } = await compressInboundImage(original, 'image/jpeg');
    const info = dimensoes(buffer);

    const match = info.match(/(\d{2,5})x(\d{2,5})/);
    expect(match).not.toBeNull();
    expect(Math.max(Number(match[1]), Number(match[2]))).toBeLessThanOrEqual(MAX_DIMENSION);
  });
});
