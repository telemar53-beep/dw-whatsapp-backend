const { findActiveCityNoticeByCityId, recordNoticeDelivery } = require('./city-notice.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');

/**
 * Escolhe QUAL aviso vale para este contato, na ordem: localidade primeiro,
 * município depois. Devolve `{ aviso, lugarId }` ou null.
 *
 * Contato sem localidade mantém exatamente a busca de antes, pelo município.
 *
 * A escolha acontece ANTES de qualquer conferência de entrega, e isso é a
 * regra, não um detalhe: um aviso da localidade **já entregue** não significa
 * "localidade sem aviso" e não pode abrir caminho para o municipal sair como
 * alternativa. Por isso, achado o aviso local, o município nem é consultado.
 *
 * "Ativo" continua sendo o que sempre foi — `enabled = true`, filtrado dentro
 * de findActiveCityNoticeByCityId. Não existe prazo de validade no modelo, e
 * este código não inventa um.
 *
 * Existe um só para que o envio automático e o contexto da IA nunca decidam
 * coisas diferentes sobre o mesmo atendimento.
 */
async function selecionarAvisoDoContato(contact) {
  if (!contact) return null;

  if (contact.localityId) {
    const local = await findActiveCityNoticeByCityId(contact.localityId);
    if (local) return { aviso: local, lugarId: contact.localityId };
  }

  if (contact.cityId) {
    const municipal = await findActiveCityNoticeByCityId(contact.cityId);
    if (municipal) return { aviso: municipal, lugarId: contact.cityId };
  }

  return null;
}

/**
 * Manda para o cliente o aviso que vale para ele, uma vez por contato por
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
  const escolha = await selecionarAvisoDoContato(contact);
  if (!escolha) return null;
  const { aviso } = escolha;
  if (!(await recordNoticeDelivery(aviso.id, contact.id))) return null;
  await enqueueOutboundMessage({ conversationId, channelId, content: aviso.message });
  return aviso;
}

module.exports = { enviarAvisoDeCidadeSePreciso, selecionarAvisoDoContato };
