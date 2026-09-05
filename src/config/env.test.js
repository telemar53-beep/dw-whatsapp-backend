const { loadConfig } = require('./env');

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.JWT_SECRET = 'secret';
    expect(() => loadConfig()).toThrow('Missing required environment variables: DATABASE_URL');
  });

  test('throws when JWT_SECRET is missing', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    delete process.env.JWT_SECRET;
    expect(() => loadConfig()).toThrow('Missing required environment variables: JWT_SECRET');
  });

  test('returns config with defaults when all required vars present', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.JWT_SECRET = 'secret';
    delete process.env.PORT;
    const config = loadConfig();
    expect(config).toEqual({ port: 3000, databaseUrl: 'postgresql://localhost/test', jwtSecret: 'secret' });
  });

  test('uses PORT env var when present', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.JWT_SECRET = 'secret';
    process.env.PORT = '4000';
    const config = loadConfig();
    expect(config.port).toBe(4000);
  });
});
