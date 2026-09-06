const { loadConfig } = require('./env');

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function setAllRequired() {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.JWT_SECRET = 'secret';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.META_VERIFY_TOKEN = 'verify-token';
    process.env.META_APP_SECRET = 'app-secret';
    process.env.BAILEYS_SESSIONS_DIR = './.baileys-sessions';
    process.env.MEDIA_STORAGE_DIR = './.media-storage';
  }

  test('throws when DATABASE_URL is missing', () => {
    setAllRequired();
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow('Missing required environment variables: DATABASE_URL');
  });

  test('throws when JWT_SECRET is missing', () => {
    setAllRequired();
    delete process.env.JWT_SECRET;
    expect(() => loadConfig()).toThrow('Missing required environment variables: JWT_SECRET');
  });

  test('throws when REDIS_URL is missing', () => {
    setAllRequired();
    delete process.env.REDIS_URL;
    expect(() => loadConfig()).toThrow('Missing required environment variables: REDIS_URL');
  });

  test('throws when META_VERIFY_TOKEN is missing', () => {
    setAllRequired();
    delete process.env.META_VERIFY_TOKEN;
    expect(() => loadConfig()).toThrow('Missing required environment variables: META_VERIFY_TOKEN');
  });

  test('throws when META_APP_SECRET is missing', () => {
    setAllRequired();
    delete process.env.META_APP_SECRET;
    expect(() => loadConfig()).toThrow('Missing required environment variables: META_APP_SECRET');
  });

  test('throws when BAILEYS_SESSIONS_DIR is missing', () => {
    setAllRequired();
    delete process.env.BAILEYS_SESSIONS_DIR;
    expect(() => loadConfig()).toThrow('Missing required environment variables: BAILEYS_SESSIONS_DIR');
  });

  test('throws when MEDIA_STORAGE_DIR is missing', () => {
    setAllRequired();
    delete process.env.MEDIA_STORAGE_DIR;
    expect(() => loadConfig()).toThrow('Missing required environment variables: MEDIA_STORAGE_DIR');
  });

  test('lists all missing variables together', () => {
    process.env = {};
    expect(() => loadConfig()).toThrow(
      'Missing required environment variables: DATABASE_URL, JWT_SECRET, REDIS_URL, META_VERIFY_TOKEN, META_APP_SECRET, BAILEYS_SESSIONS_DIR, MEDIA_STORAGE_DIR'
    );
  });

  test('returns config with defaults when all required vars present', () => {
    setAllRequired();
    delete process.env.PORT;
    const config = loadConfig();
    expect(config).toEqual({
      port: 3000,
      databaseUrl: 'postgresql://localhost/test',
      jwtSecret: 'secret',
      redisUrl: 'redis://localhost:6379',
      metaVerifyToken: 'verify-token',
      metaAppSecret: 'app-secret',
      baileysSessionsDir: './.baileys-sessions',
      mediaStorageDir: './.media-storage',
      frontendOrigin: null,
    });
  });

  test('uses PORT env var when present', () => {
    setAllRequired();
    process.env.PORT = '4000';
    const config = loadConfig();
    expect(config.port).toBe(4000);
  });

  test('frontendOrigin is null when FRONTEND_ORIGIN is not set', () => {
    setAllRequired();
    delete process.env.FRONTEND_ORIGIN;
    const config = loadConfig();
    expect(config.frontendOrigin).toBeNull();
  });

  test('frontendOrigin reflects FRONTEND_ORIGIN when set', () => {
    setAllRequired();
    process.env.FRONTEND_ORIGIN = 'https://dw-whatsapp-frontend.onrender.com';
    const config = loadConfig();
    expect(config.frontendOrigin).toBe('https://dw-whatsapp-frontend.onrender.com');
  });

  test('does not require FRONTEND_ORIGIN to be set', () => {
    setAllRequired();
    delete process.env.FRONTEND_ORIGIN;
    expect(() => loadConfig()).not.toThrow();
  });
});
