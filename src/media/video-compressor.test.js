const { execFileSync, spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { compressVideo, MAX_VIDEO_HEIGHT, VIDEO_COMPRESSION_THRESHOLD_BYTES } = require('./video-compressor');

// Vídeo de verdade, gerado pelo ffmpeg do próprio projeto.
function gerarVideo({ size = '1920x1080', seconds = 6 } = {}) {
  return execFileSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=30:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0',
      '-c:a', 'aac',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4', 'pipe:1',
    ],
    { maxBuffer: 256 * 1024 * 1024 }
  );
}

function ffmpegConsegueLer(buffer) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'null', '-'], { input: buffer, maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0;
}

function altura(buffer) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', 'pipe:0'], { input: buffer, maxBuffer: 256 * 1024 * 1024 });
  const m = String(r.stderr || '').match(/(\d{2,5})x(\d{2,5})/);
  return m ? Number(m[2]) : null;
}

describe('compressVideo', () => {
  jest.setTimeout(180000);

  test('reduz um vídeo grande e o resultado continua reproduzível', () => {
    const original = gerarVideo();
    expect(original.length).toBeGreaterThan(VIDEO_COMPRESSION_THRESHOLD_BYTES);

    const { buffer, mimeType } = compressVideo(original, 'video/mp4');

    expect(buffer.length).toBeLessThan(original.length);
    expect(mimeType).toBe('video/mp4');
    expect(ffmpegConsegueLer(buffer)).toBe(true);
  });

  test('limita a altura do vídeo', () => {
    const original = gerarVideo();

    const { buffer } = compressVideo(original, 'video/mp4');

    expect(altura(buffer)).toBeLessThanOrEqual(MAX_VIDEO_HEIGHT);
  });

  test('não mexe num vídeo que já é pequeno', () => {
    const pequeno = Buffer.alloc(VIDEO_COMPRESSION_THRESHOLD_BYTES - 1, 3);

    const { buffer } = compressVideo(pequeno, 'video/mp4');

    expect(buffer).toBe(pequeno);
  });

  test('não mexe no que não é vídeo', () => {
    const imagem = Buffer.alloc(VIDEO_COMPRESSION_THRESHOLD_BYTES + 1, 5);

    const { buffer, mimeType } = compressVideo(imagem, 'image/jpeg');

    expect(buffer).toBe(imagem);
    expect(mimeType).toBe('image/jpeg');
  });

  // A mensagem do cliente nunca pode se perder por causa de uma otimização.
  test('bytes que o ffmpeg não lê voltam como vieram', () => {
    const lixo = Buffer.alloc(VIDEO_COMPRESSION_THRESHOLD_BYTES + 1, 7);

    const { buffer } = compressVideo(lixo, 'video/mp4');

    expect(buffer).toBe(lixo);
  });
});
