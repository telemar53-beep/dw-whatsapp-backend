const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const ffmpegPath = require('ffmpeg-static');
const { normalizeAudioForWhatsApp, isWhatsAppSafeAudioMimeType } = require('./audio-normalizer');

const execFileAsync = promisify(execFile);

// WhatsApp clients cannot decode WebM, which is exactly what Chrome's MediaRecorder
// produces. These fixtures are generated with the bundled ffmpeg so the test exercises
// real container bytes instead of a stand-in string.
async function encodeTone(format, extraArgs = []) {
  const { stdout } = await execFileAsync(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'libopus', '-b:a', '32k', ...extraArgs, '-f', format, 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }
  );
  return stdout;
}

describe('isWhatsAppSafeAudioMimeType', () => {
  test.each([
    ['audio/ogg', true],
    ['audio/ogg; codecs=opus', true],
    ['audio/mpeg', true],
    ['audio/mp4', true],
    ['audio/amr', true],
    ['audio/webm', false],
    ['audio/webm;codecs=opus', false],
    ['audio/wav', false],
    [undefined, false],
  ])('reports %s as %s', (mimeType, expected) => {
    expect(isWhatsAppSafeAudioMimeType(mimeType)).toBe(expected);
  });
});

describe('normalizeAudioForWhatsApp', () => {
  jest.setTimeout(30000);

  test('converts a WebM/Opus recording into Ogg/Opus that WhatsApp can decode', async () => {
    const webm = await encodeTone('webm');
    expect(webm.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])); // EBML/WebM

    const result = await normalizeAudioForWhatsApp(webm, 'audio/webm;codecs=opus');

    expect(result.buffer.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(result.mimeType).toBe('audio/ogg; codecs=opus');
    expect(result.converted).toBe(true);
  });

  test('produces mono 48kHz Opus, the shape WhatsApp expects for voice audio', async () => {
    const webm = await encodeTone('webm');
    const result = await normalizeAudioForWhatsApp(webm, 'audio/webm;codecs=opus');

    // execFile has no way to feed stdin, so probe from a real file on disk.
    const probePath = path.join(os.tmpdir(), `dw-audio-probe-${process.pid}.ogg`);
    fs.writeFileSync(probePath, result.buffer);
    try {
      const { stderr } = spawnSync(ffmpegPath, ['-hide_banner', '-i', probePath, '-f', 'null', '-'], {
        encoding: 'utf8',
      });
      expect(stderr).toMatch(/Audio: opus, 48000 Hz, mono/);
    } finally {
      fs.rmSync(probePath, { force: true });
    }
  });

  test('leaves an already WhatsApp-safe Ogg recording untouched', async () => {
    const ogg = await encodeTone('ogg', ['-ac', '1', '-ar', '48000']);

    const result = await normalizeAudioForWhatsApp(ogg, 'audio/ogg; codecs=opus');

    expect(result.buffer).toBe(ogg);
    expect(result.mimeType).toBe('audio/ogg; codecs=opus');
    expect(result.converted).toBe(false);
  });

  test('rejects audio it cannot convert instead of silently forwarding it to WhatsApp', async () => {
    await expect(normalizeAudioForWhatsApp(Buffer.from('not audio at all'), 'audio/webm')).rejects.toThrow(
      /could not be converted/i
    );
  });
});
