function loadConfig() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'REDIS_URL',
    'META_VERIFY_TOKEN',
    'META_APP_SECRET',
    'BAILEYS_SESSIONS_DIR',
    'MEDIA_STORAGE_DIR',
    'PUBLIC_BASE_URL',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    redisUrl: process.env.REDIS_URL,
    metaVerifyToken: process.env.META_VERIFY_TOKEN,
    metaAppSecret: process.env.META_APP_SECRET,
    baileysSessionsDir: process.env.BAILEYS_SESSIONS_DIR,
    mediaStorageDir: process.env.MEDIA_STORAGE_DIR,
    frontendOrigin: process.env.FRONTEND_ORIGIN || null,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  };
}

module.exports = { loadConfig };
