const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Containers WhatsApp clients are able to decode. Anything outside this list reaches the
// recipient as a message their app silently drops, so it has to be converted before we
// hand it to an adapter. Notably absent: WebM, which is what Chrome's and Edge's
// MediaRecorder produces when the attendant records a voice message in the browser.
const WHATSAPP_SAFE_AUDIO_MIME_TYPES = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  'audio/3gpp',
]);

const OGG_OPUS_MIME_TYPE = 'audio/ogg; codecs=opus';

function baseMimeType(mimeType) {
  if (typeof mimeType !== 'string') return '';
  return mimeType.split(';')[0].trim().toLowerCase();
}

function isWhatsAppSafeAudioMimeType(mimeType) {
  return WHATSAPP_SAFE_AUDIO_MIME_TYPES.has(baseMimeType(mimeType));
}

// Mono 48kHz Opus in an Ogg container: the same shape WhatsApp itself uses for voice
// messages, which also lets Baileys read back a duration for the message bubble.
function transcodeToOggOpus(buffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libopus',
      '-ac', '1',
      '-ar', '48000',
      '-b:a', '32k',
      '-f', 'ogg',
      'pipe:1',
    ]);

    const stdoutChunks = [];
    const stderrChunks = [];
    ffmpeg.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    // ffmpeg closes stdin as soon as it rejects the input, so writing the rest of the
    // buffer raises EPIPE. The exit code below is the real signal; ignore the write error.
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.on('error', (err) => reject(err));
    ffmpeg.on('close', (code) => {
      const output = Buffer.concat(stdoutChunks);
      if (code !== 0 || output.length === 0) {
        const details = Buffer.concat(stderrChunks).toString().trim();
        reject(new Error(`Audio could not be converted to Ogg/Opus${details ? `: ${details}` : ''}`));
        return;
      }
      resolve(output);
    });

    ffmpeg.stdin.end(buffer);
  });
}

async function normalizeAudioForWhatsApp(buffer, mimeType) {
  if (isWhatsAppSafeAudioMimeType(mimeType)) {
    return { buffer, mimeType, converted: false };
  }
  const converted = await transcodeToOggOpus(buffer);
  return { buffer: converted, mimeType: OGG_OPUS_MIME_TYPE, converted: true };
}

module.exports = { normalizeAudioForWhatsApp, isWhatsAppSafeAudioMimeType, OGG_OPUS_MIME_TYPE };
