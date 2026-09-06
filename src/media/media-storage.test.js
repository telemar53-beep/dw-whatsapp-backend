const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../config/env');
const {
  saveMediaFile,
  getMediaFilePath,
  extensionForMimeType,
  messageTypeForMimeType,
} = require('./media-storage');

describe('media-storage', () => {
  let tempDir;
  let originalMediaStorageDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-media-test-'));
    originalMediaStorageDir = process.env.MEDIA_STORAGE_DIR;
    process.env.MEDIA_STORAGE_DIR = tempDir;
  });

  afterEach(() => {
    process.env.MEDIA_STORAGE_DIR = originalMediaStorageDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('saveMediaFile / getMediaFilePath', () => {
    test('writes the buffer to disk and returns a relative path with the given extension', async () => {
      const buffer = Buffer.from('fake image bytes');
      const relativePath = await saveMediaFile(buffer, '.jpg');

      expect(relativePath).toMatch(/\.jpg$/);
      const fullPath = getMediaFilePath(relativePath);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.readFileSync(fullPath)).toEqual(buffer);
    });

    test('generates a different path for each call, even with the same extension', async () => {
      const path1 = await saveMediaFile(Buffer.from('a'), '.pdf');
      const path2 = await saveMediaFile(Buffer.from('b'), '.pdf');
      expect(path1).not.toBe(path2);
    });

    test('creates the storage directory if it does not exist yet', async () => {
      const nestedDir = path.join(tempDir, 'does-not-exist-yet');
      process.env.MEDIA_STORAGE_DIR = nestedDir;
      const relativePath = await saveMediaFile(Buffer.from('x'), '.png');
      expect(fs.existsSync(getMediaFilePath(relativePath))).toBe(true);
    });
  });

  describe('getMediaFilePath path resolution and containment', () => {
    test('returns an absolute path even when MEDIA_STORAGE_DIR is configured as a relative path', () => {
      const relativeDirName = 'some-relative-media-dir-for-test';
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      try {
        process.env.MEDIA_STORAGE_DIR = `./${relativeDirName}`;
        const result = getMediaFilePath('some-file.jpg');
        expect(path.isAbsolute(result)).toBe(true);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(path.join(tempDir, relativeDirName), { recursive: true, force: true });
      }
    });

    test('throws when relativePath would escape the configured storage directory', () => {
      expect(() => getMediaFilePath('../../etc/passwd')).toThrow('Invalid media path');
    });
  });

  describe('extensionForMimeType', () => {
    test.each([
      ['image/jpeg', '.jpg'],
      ['image/png', '.png'],
      ['application/pdf', '.pdf'],
      ['audio/ogg; codecs=opus', '.ogg'],
      ['video/mp4', '.mp4'],
    ])('maps %s to %s', (mimeType, expected) => {
      expect(extensionForMimeType(mimeType)).toBe(expected);
    });

    test('returns an empty string for an unknown mime type', () => {
      expect(extensionForMimeType('application/x-made-up')).toBe('');
    });

    test('returns an empty string when mimeType is falsy', () => {
      expect(extensionForMimeType(null)).toBe('');
    });
  });

  describe('messageTypeForMimeType', () => {
    test.each([
      ['image/jpeg', 'image'],
      ['audio/ogg', 'audio'],
      ['video/mp4', 'video'],
      ['application/pdf', 'document'],
      ['application/octet-stream', 'document'],
    ])('maps %s to %s', (mimeType, expected) => {
      expect(messageTypeForMimeType(mimeType)).toBe(expected);
    });

    test('defaults to document when mimeType is falsy', () => {
      expect(messageTypeForMimeType(null)).toBe('document');
    });
  });
});
