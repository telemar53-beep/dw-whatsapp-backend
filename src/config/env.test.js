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
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.MEDIA_TOKEN_SECRET = 'media-secret';
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

  test('throws when PUBLIC_BASE_URL is missing', () => {
    setAllRequired();
    delete process.env.PUBLIC_BASE_URL;
    expect(() => loadConfig()).toThrow('Missing required environment variables: PUBLIC_BASE_URL');
  });

  test('lists all missing variables together', () => {
    process.env = {};
    expect(() => loadConfig()).toThrow(
      'Missing required environment variables: DATABASE_URL, JWT_SECRET, REDIS_URL, META_VERIFY_TOKEN, META_APP_SECRET, BAILEYS_SESSIONS_DIR, MEDIA_STORAGE_DIR, PUBLIC_BASE_URL'
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
      publicBaseUrl: 'http://localhost:3000',
      mediaTokenSecret: 'media-secret',
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

  test('strips a trailing slash from PUBLIC_BASE_URL', () => {
    setAllRequired();
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000/';
    const config = loadConfig();
    expect(config.publicBaseUrl).toBe('http://localhost:3000');
  });
});

// Ate 2026-09-16 a checagem so olhava se a variavel EXISTIA. Foi por esse
// buraco que META_APP_SECRET=producao-app-secret-trocar-depois subiu para a
// producao e derrubou 100% das mensagens do canal oficial, em silencio, por
// semanas. Em producao o processo agora se recusa a subir.
describe('loadConfig — conteudo das variaveis em producao', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
    process.env.JWT_SECRET = 'eaf84e75960169653f9e1530ef8ad38dd6d471f5ce273c8760da1b7f6248ab04';
    process.env.REDIS_URL = 'redis://red-dae80fgu01pc73df9vh0:6379';
    process.env.META_VERIFY_TOKEN = 'f12d98931e78124cedc72f95348c8047a184aef835389514';
    process.env.META_APP_SECRET = '3f8b1c2d4e5a6b7c8d9e0f1a2b3c4d5e';
    process.env.BAILEYS_SESSIONS_DIR = '/var/data/baileys-sessions';
    process.env.MEDIA_STORAGE_DIR = '/var/data/media';
    process.env.PUBLIC_BASE_URL = 'https://dw-whatsapp-backend.onrender.com';
    process.env.MEDIA_TOKEN_SECRET = '9c1f0b7a4e2d8f6c3b5a7e9d1c4f8b2a6e0d3c7f5b9a1e4d8c2f6b0a3e7d5c9f';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('aceita uma configuracao de producao valida', () => {
    expect(() => loadConfig()).not.toThrow();
  });

  test('recusa META_APP_SECRET que nao tem a cara de uma chave de app da Meta', () => {
    process.env.META_APP_SECRET = 'producao-app-secret-trocar-depois';
    expect(() => loadConfig()).toThrow(/META_APP_SECRET/);
  });

  test('recusa META_APP_SECRET hexadecimal de tamanho errado', () => {
    process.env.META_APP_SECRET = '3f8b1c2d4e5a6b7c';
    expect(() => loadConfig()).toThrow(/META_APP_SECRET/);
  });

  test('recusa um valor que sobrou do modelo, em qualquer variavel', () => {
    process.env.META_VERIFY_TOKEN = 'troque-este-valor-antes-do-deploy';
    expect(() => loadConfig()).toThrow(/META_VERIFY_TOKEN/);
  });

  test('recusa PUBLIC_BASE_URL apontando para a maquina local', () => {
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    expect(() => loadConfig()).toThrow(/PUBLIC_BASE_URL/);
  });

  test('recusa JWT_SECRET curto demais', () => {
    process.env.JWT_SECRET = 'segredo';
    expect(() => loadConfig()).toThrow(/JWT_SECRET/);
  });

  test('reclama de todos os problemas de uma vez', () => {
    process.env.META_APP_SECRET = 'producao-app-secret-trocar-depois';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    let mensagem = '';
    try {
      loadConfig();
    } catch (err) {
      mensagem = err.message;
    }
    expect(mensagem).toMatch(/META_APP_SECRET/);
    expect(mensagem).toMatch(/PUBLIC_BASE_URL/);
  });

  test('nunca imprime o valor da variavel no erro', () => {
    process.env.JWT_SECRET = 'troque-este-segredo-de-verdade-aqui';
    let mensagem = '';
    try {
      loadConfig();
    } catch (err) {
      mensagem = err.message;
    }
    expect(mensagem).toMatch(/JWT_SECRET/);
    expect(mensagem).not.toContain('troque-este-segredo-de-verdade-aqui');
  });

  test('fora de producao nao barra nada, para nao travar dev e teste', () => {
    process.env.NODE_ENV = 'test';
    process.env.META_APP_SECRET = 'app-secret';
    process.env.JWT_SECRET = 'secret';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    expect(() => loadConfig()).not.toThrow();
  });


  test('exige MEDIA_TOKEN_SECRET: sem ela nao ha como emitir token de midia', () => {
    delete process.env.MEDIA_TOKEN_SECRET;
    expect(() => loadConfig()).toThrow('Missing required environment variables: MEDIA_TOKEN_SECRET');
  });

  test('recusa MEDIA_TOKEN_SECRET igual ao JWT_SECRET: isso anularia a separacao', () => {
    process.env.MEDIA_TOKEN_SECRET = process.env.JWT_SECRET;
    expect(() => loadConfig()).toThrow(/anula a separacao/);
  });

  test('recusa MEDIA_TOKEN_SECRET curta demais', () => {
    process.env.MEDIA_TOKEN_SECRET = 'curta';
    expect(() => loadConfig()).toThrow(/MEDIA_TOKEN_SECRET tem menos de/);
  });
});