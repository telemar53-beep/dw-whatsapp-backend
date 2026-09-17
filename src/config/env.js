// Checar so se a variavel EXISTE nao basta: em 2026-09-16 descobrimos que
// META_APP_SECRET=producao-app-secret-trocar-depois estava em producao havia
// semanas, derrubando 100% das mensagens do canal oficial num 403 silencioso.
// A variavel estava la — so nao valia nada. Estas regras sao sobre o CONTEUDO,
// e valem so em producao: dev e teste usam valores de mentira de proposito.
//
// Nenhuma mensagem inclui o valor da variavel: metade delas e segredo.
// So termos longos o bastante para nao aparecerem por acaso: DATABASE_URL e
// REDIS_URL carregam senhas aleatorias, e um "xxx" ou "todo" na regra derrubaria
// a subida por coincidencia de caracteres numa senha legitima.
const PLACEHOLDER = /troque|trocar|changeme|change-me|placeholder|exemplo|example/i;
const META_APP_SECRET_FORMAT = /^[0-9a-f]{32}$/;
const JWT_SECRET_MIN_LENGTH = 32;

// So as variaveis do projeto: varrer o ambiente inteiro daria falso positivo em
// qualquer PATH ou variavel do sistema que por acaso contenha "example".
function contentProblems(env, keys) {
  const problems = [];
  for (const key of keys) {
    if (PLACEHOLDER.test(env[key] || '')) {
      problems.push(`${key} ainda esta com um valor de modelo`);
    }
  }
  if (!META_APP_SECRET_FORMAT.test(env.META_APP_SECRET || '')) {
    problems.push('META_APP_SECRET nao tem a cara de uma chave de app da Meta (32 caracteres de 0-9a-f)');
  }
  if ((env.JWT_SECRET || '').length < JWT_SECRET_MIN_LENGTH) {
    problems.push(`JWT_SECRET tem menos de ${JWT_SECRET_MIN_LENGTH} caracteres`);
  }
  if (/localhost|127\.0\.0\.1/.test(env.PUBLIC_BASE_URL || '')) {
    problems.push('PUBLIC_BASE_URL aponta para a maquina local, entao nenhum webhook chegaria');
  }
  return problems;
}

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

  if (process.env.NODE_ENV === 'production') {
    const problems = contentProblems(process.env, required);
    if (problems.length > 0) {
      throw new Error(`Variaveis de ambiente invalidas em producao:\n- ${problems.join('\n- ')}`);
    }
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
    publicBaseUrl: process.env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
  };
}

module.exports = { loadConfig };
