const { verifyToken } = require('./auth.service');
const { verifyMediaToken } = require('./media-token.service');
const { hasAdminLevelAccess } = require('./auth.middleware');

/**
 * Autenticação das três rotas de leitura de arquivo: mídia, avatar de contato e
 * avatar de agente. Estes são os únicos lugares do produto em que a credencial
 * precisa viajar na URL, porque <img>, <audio>, <video> e <a download> são
 * buscas de sub-recurso do navegador e não têm como mandar header.
 *
 * Dois caminhos:
 *
 *   1. `?mediaToken=` — o token dedicado, com segredo próprio e 30 minutos de
 *      validade. É como o navegador carrega imagem, áudio, vídeo e download.
 *   2. header `Authorization` com o JWT de sessão — para quem controla a
 *      requisição e portanto consegue mandar header. Não vaza em log de proxy,
 *      histórico nem print, então continua valendo.
 *
 * O que NÃO existe mais é `?token=` com o JWT de sessão. Era o caminho antigo,
 * mantido durante a migração para o frontend publicado não perder as imagens;
 * validado o caminho novo em produção, ele saiu. Um JWT de sessão numa URL é
 * uma credencial de 12 horas em texto claro no log do balanceador, no histórico
 * do navegador e em qualquer print de tela.
 *
 * Qualquer que seja o caminho, o resultado é o mesmo objeto mínimo em
 * `req.leitorDeMidia`, para a rota não precisar saber por onde a credencial
 * chegou.
 */
function autenticarLeituraDeMidia(req, res, next) {
  const mediaToken = typeof req.query.mediaToken === 'string' ? req.query.mediaToken : null;
  if (mediaToken) {
    try {
      const { agentId, podeVerSilent } = verifyMediaToken(mediaToken);
      req.leitorDeMidia = { agentId, podeVerSilent, via: 'media-token' };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  const header = req.headers.authorization;
  const headerToken = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!headerToken) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  try {
    const agente = verifyToken(headerToken);
    req.agent = agente;
    req.leitorDeMidia = {
      agentId: agente.agentId,
      podeVerSilent: hasAdminLevelAccess(agente),
      via: 'sessao',
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { autenticarLeituraDeMidia };
