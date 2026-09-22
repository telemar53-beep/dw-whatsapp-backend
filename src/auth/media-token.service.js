const jwt = require('jsonwebtoken');

// O token que vai na URL de mídia e avatar. Não é o JWT de sessão, e a
// separação é CRIPTOGRÁFICA, não uma claim: segredo próprio, então um token de
// mídia não passa em verifyToken (assinatura inválida) e um token de sessão não
// passa aqui. O `typ` abaixo é defesa em profundidade, para o caso de alguém um
// dia apontar as duas variáveis para o mesmo valor.
const MEDIA_TOKEN_EXPIRY_SECONDS = 30 * 60;
const TIPO = 'media';

// Sem fallback para JWT_SECRET de propósito. Cair no segredo de sessão faria o
// token de mídia virar token de sessão em silêncio — exatamente o que esta
// separação existe para impedir. Ausência tem que doer e aparecer.
function segredo() {
  const valor = process.env.MEDIA_TOKEN_SECRET;
  if (!valor) {
    throw Object.assign(
      new Error('MEDIA_TOKEN_SECRET não está definida: sem ela não há como emitir nem conferir token de mídia'),
      { code: 'MEDIA_TOKEN_SECRET_MISSING' }
    );
  }
  return valor;
}

/**
 * Emite o token de leitura de mídia de um agente.
 *
 * Carrega o mínimo: quem é, para que serve, até quando vale, e uma única
 * permissão booleana. Nada de role completo, CPF, nota interna ou dado do SGP —
 * se a URL vazar, o que vaza é "ler mídia por 30 minutos", e mais nada.
 *
 * `silent` é booleano em vez de role porque a regra de conversa silenciada é a
 * ÚNICA distinção administrativa que a rota de mídia faz. Mandar `role: 'admin'`
 * daria ao token um poder que ele não precisa ter.
 */
function signMediaToken({ agentId, podeVerSilent }) {
  return jwt.sign(
    { typ: TIPO, sil: podeVerSilent === true },
    segredo(),
    { subject: String(agentId), expiresIn: MEDIA_TOKEN_EXPIRY_SECONDS }
  );
}

/**
 * Confere e devolve `{ agentId, podeVerSilent }`, ou lança.
 * `subject` no verify fecha o outro lado da porta: um token sem `sub` é
 * recusado, então nem um JWT de sessão assinado por engano com este segredo
 * passaria por aqui.
 */
function verifyMediaToken(token) {
  const payload = jwt.verify(token, segredo(), { algorithms: ['HS256'] });
  if (payload.typ !== TIPO || !payload.sub) {
    throw Object.assign(new Error('Token de mídia inválido'), { code: 'MEDIA_TOKEN_INVALID' });
  }
  return { agentId: payload.sub, podeVerSilent: payload.sil === true };
}

module.exports = { signMediaToken, verifyMediaToken, MEDIA_TOKEN_EXPIRY_SECONDS };
