const { findActiveCityNoticeByCityId, recordNoticeDelivery } = require('./city-notice.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');

/**
 * Manda para o cliente o aviso ativo da cidade dele, uma vez por contato por
 * ativação do aviso (quem decide isso é recordNoticeDelivery, que só devolve
 * true na primeira vez). Devolve o aviso enviado, ou null quando não havia o
 * que mandar.
 *
 * Mora aqui, e não dentro do fluxo de entrada, porque a triagem por IA chama a
 * mesma coisa depois de descobrir a cidade do cliente no SGP — nesse turno o
 * contato ainda estava sem cidade quando a mensagem chegou.
 *
 * Não engole erro: cada chamador tem um jeito próprio de seguir sem o aviso.
 */
async function enviarAvisoDeCidadeSePreciso({ contact, conversationId, channelId }) {
  const aviso = await findActiveCityNoticeByCityId(contact.cityId);
  if (!aviso) return null;
  if (!(await recordNoticeDelivery(aviso.id, contact.id))) return null;
  await enqueueOutboundMessage({ conversationId, channelId, content: aviso.message });
  return aviso;
}

module.exports = { enviarAvisoDeCidadeSePreciso };
