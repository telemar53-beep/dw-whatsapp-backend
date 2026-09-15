const { processOutboundQueue, enqueueOutboundMessage } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, recordMessageSent, markPixFallbackSent, markMessageFailed } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { lerRecebedorDoPix, resolverRecebedorPix } = require('../payments/pix-emv');
const { isOfficialChannelType } = require('../channels/channel-types');
const { getCompanyConfig } = require('../company/company-config.repository');
const { cartaoPix } = require('../payments/payment-card');
const { mensagemSegura } = require('../ai/safe-error-log');
const { motivoDaResposta } = require('../whatsapp-adapters/meta-error');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
  '360dialog': threeSixtyDialogAdapter,
};

const AUDIO_DELIVERY_CHECK_DELAY_MS = 5000;
const PIX_DELIVERY_CHECK_DELAY_MS = 60000;

// Baileys can mark an audio message delivered even when WhatsApp never lets the recipient
// download it - the customer just sees a broken bubble with no signal back to us (see
// verifyMediaDelivery). A few seconds after sending, check whether the file is actually
// retrievable, and if it isn't, resend it automatically so the attendant doesn't have to
// notice a stuck customer and fix it by hand.
async function checkAudioDelivery({ channel, whatsappMessageId, conversation, mediaPath, mediaMimeType, mediaFilename, isVoiceNote }) {
  const result = await baileysManager.verifyMediaDelivery(channel, whatsappMessageId, conversation.contactPhoneNumber);
  if (result.verified !== false) {
    console.log(`Audio delivery check for ${whatsappMessageId}: verified=${result.verified} reason=${result.reason || 'n/a'}`);
    return;
  }
  console.warn(`Audio ${whatsappMessageId} failed delivery verification (${result.reason}); resending automatically`);
  const resent = await enqueueOutboundMessage({
    conversationId: conversation.id,
    channelId: channel.id,
    messageType: 'audio',
    mediaPath,
    mediaMimeType,
    mediaFilename,
    isVoiceNote,
  });
  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation, message: resent });
  }
}

function scheduleAudioDeliveryCheck(ctx) {
  setTimeout(() => {
    checkAudioDelivery(ctx).catch((err) => {
      console.error(`Audio delivery check crashed for ${ctx.whatsappMessageId}`, err);
    });
  }, AUDIO_DELIVERY_CHECK_DELAY_MS);
}

// O cartao nativo de Pix e uma mensagem interativa, e nem todo aparelho a
// reconhece: no teste de 2026-09-14 o cartao ficou com um tique so (o servidor
// aceitou) enquanto o texto seguinte chegou com dois. Como o relayMessage nao
// falha nesse caso, a unica pista que temos e a ausencia do recibo de entrega.
// Um minuto depois do envio, se a mensagem continua em 'sent', mandamos o de
// sempre - cartao de texto + codigo sozinho - para o cliente nao ficar sem o
// Pix por causa do aparelho dele.
async function checkPixDelivery({ messageId, conversation, channel, pixCode, metadata }) {
  const msg = await findMessageById(messageId);
  if (!msg || msg.status === 'delivered' || msg.status === 'read') {
    console.log(`Pix card ${msg ? msg.whatsappMessageId : messageId} delivered`);
    return;
  }
  // O caminho de falha do envio ja cuidou desta mensagem; nao duplicar.
  if (msg.status === 'failed') return;

  // A marca vive na metadata da mensagem, no banco: um restart do worker ou um
  // retry da fila nao pode mandar o codigo duas vezes.
  const marcou = await markPixFallbackSent(messageId, 'cartao_nao_entregue');
  if (!marcou) return;

  console.warn(`Pix card ${messageId} got no delivery receipt after 60s; sending the text fallback`);
  const textos = [cartaoPix({ valor: (metadata || {}).value, vencimento: (metadata || {}).dueDate }), pixCode];
  for (const content of textos) {
    const enviada = await enqueueOutboundMessage({
      conversationId: conversation.id,
      channelId: channel.id,
      content,
      messageType: 'text',
      sentBy: msg.sentBy,
    });
    if (conversation.assignedAgentId) {
      emitToAgent(conversation.assignedAgentId, 'message:new', { conversation, message: enviada });
    }
  }
}

function schedulePixDeliveryCheck(ctx) {
  setTimeout(() => {
    checkPixDelivery(ctx).catch((err) => {
      // mensagemSegura: o codigo Pix nao entra em log nenhum, nem pelo erro.
      console.error(`Pix delivery check crashed for ${ctx.messageId}: ${mensagemSegura(err)}`);
    });
  }, PIX_DELIVERY_CHECK_DELAY_MS);
}

// O erro da Meta traz o motivo real da recusa do cartão em
// err.response.data.error; o resto da resposta - e principalmente o corpo da
// requisição, que leva o copia e cola - nunca entra em log. Por isso só estes
// quatro campos, um a um, e nunca o objeto inteiro.
//
// O 360dialog (e qualquer outra API que fuja do formato da Meta) não traz esse
// campo error, então cai no outro ramo: aí é seguro logar a RESPOSTA inteira
// (truncada) porque é sempre a resposta de uma chamada que falhou - ela nunca
// carrega de volta o corpo da nossa requisição, então não tem código Pix nem
// conteúdo de mensagem para vazar.
function detalheDaApi(err) {
  const response = err && err.response;
  if (!response) return '';
  const data = response.data;
  const apiError = data && typeof data === 'object' && data.error;
  if (apiError && typeof apiError === 'object') {
    const { code, type, message, error_data: errorData } = apiError;
    return ` api=${JSON.stringify({ code, type, message, error_data: errorData })}`;
  }
  const body = data !== undefined ? ` body=${JSON.stringify(data).slice(0, 500)}` : '';
  return ` status=${response.status}${body}`;
}

/**
 * Manda o Pix da melhor forma que o canal aceitar, sem nunca deixar o cliente
 * sem o código.
 *
 * A preferência é o cartão nativo do WhatsApp, com botão "Copiar código Pix".
 * Nos canais oficiais ele exige o recebedor (nome, chave e tipo), que sai de
 * dentro do próprio código Pix do boleto; se o código for dinâmico e não
 * trouxer a chave embutida, os canais oficiais ainda tentam resolvê-la
 * buscando a própria URL de cobrança do código antes de cair para texto. No
 * Baileys não há nada disso: lá a "chave" declarada é o próprio copia e cola,
 * lido sem nenhuma chamada de rede.
 *
 * A decisão fica aqui, na hora do envio, e não em quem enfileirou: só agora se
 * sabe por qual canal a mensagem vai sair e o que o código carrega. E quando o
 * cartão falha — código sem chave, API recusando, adaptador que nem sabe mandar
 * cartão — a queda é para o formato de sempre (cartão de texto + código
 * sozinho), nunca para uma mensagem não entregue.
 *
 * O id gravado na mensagem é o do envio do código: é essa a bolha que o cliente
 * copia, e é por ela que os recibos de entrega/leitura devem ser casados.
 */
async function sendPixOrFallback({ adapter, channel, to, pixCode, metadata }) {
  const oficial = isOfficialChannelType(channel.type);
  const merchant = oficial ? await resolverRecebedorPix(pixCode) : lerRecebedorDoPix(pixCode);
  // Código dinâmico (só a URL do payload) ou texto que nem é EMV: não há chave
  // para declarar, e a API oficial recusaria o cartão.
  const semChaveNoOficial = oficial && (!merchant || !merchant.key);
  // O motivo da queda acompanha a mensagem até o chat: sem ele o atendente vê a
  // bolha de texto e não sabe por que o cartão não saiu. Fica indefinido quando
  // o adaptador simplesmente não sabe mandar cartão: aí não faltou nada ao
  // código, e o chat diz só que o cliente recebeu o texto.
  let motivoTexto;
  if (typeof adapter.sendPixCardMessage === 'function' && semChaveNoOficial) {
    // Sem o código em log, nunca: só o fato de ele não trazer a chave.
    console.error(`Pix code carries no merchant key; card needs it on official channels (channel ${channel.id})`);
    motivoTexto = 'codigo_sem_chave';
  }
  if (typeof adapter.sendPixCardMessage === 'function' && !semChaveNoOficial) {
    // A Meta exige merchant_name junto da chave, e nem todo código traz a tag
    // 59. O builder é puro, então o nome de reserva (empresa, depois canal) é
    // resolvido aqui. No Baileys o merchant vai como veio: o builder de lá já
    // tem a própria queda para o nome da empresa.
    let recebedor = merchant;
    if (oficial && !merchant.name) {
      const empresa = await getCompanyConfig();
      recebedor = { ...merchant, name: empresa.name || channel.name };
    }
    try {
      const { whatsappMessageId } = await adapter.sendPixCardMessage(channel, to, {
        pixCode,
        value: metadata.value,
        dueDate: metadata.dueDate,
        faturaId: metadata.faturaId,
        merchant: recebedor,
      });
      return { whatsappMessageId, viaCartao: true };
    } catch (err) {
      // mensagemSegura, e nunca o erro cru nem o pixCode: o código Pix não entra
      // em log nenhum. O detalhe da API (por que ela recusou o cartão) só sai
      // pelos quatro campos do objeto de erro dela - nunca o corpo enviado, que
      // carrega o copia e cola.
      console.error(`Pix card send failed on channel ${channel.id}, falling back to text: ${mensagemSegura(err)}${detalheDaApi(err)}`);
      motivoTexto = 'cartao_recusado';
    }
  }
  await adapter.sendTextMessage(channel, to, cartaoPix({ valor: metadata.value, vencimento: metadata.dueDate }));
  const { whatsappMessageId } = await adapter.sendTextMessage(channel, to, pixCode);
  return { whatsappMessageId, viaCartao: false, motivoTexto };
}

// Teste real 2026-09-15: em Automação/Espera a resposta da IA, o boleto e a
// linha digitável só apareciam no F5. O worker avisava só o atendente
// atribuído — e uma conversa em triagem não tem nenhum. Sem dono, a mensagem
// vai a todos os conectados como message:new (quem está com a conversa
// aberta acrescenta a bolha; a tela filtra pela conversa). Com dono, continua
// message:updated só para ele, como sempre.
function avisarTela(conversation, conversationId, message) {
  if (!message) return;
  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
  } else {
    broadcast('message:new', { conversation, message });
  }
}

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, metadata, mediaPath, mediaMimeType, mediaFilename, isVoiceNote, templateName, templateLanguage, templateVariables, headerType, headerLink, repliedToMessageId }) => {
    const existingMessage = await findMessageById(messageId);
    if (existingMessage && existingMessage.whatsappMessageId) return;
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];

      let replyOptions;
      if (repliedToMessageId) {
        const original = await findMessageById(repliedToMessageId);
        if (original) {
          replyOptions = {
            repliedToWhatsappMessageId: original.whatsappMessageId,
            repliedToDirection: original.direction,
            repliedToContent: original.content,
          };
        }
      }

      const { whatsappMessageId, viaCartao, motivoTexto } = templateName
        ? await adapter.sendTemplateMessage(channel, conversation.contactPhoneNumber, {
            name: templateName,
            language: templateLanguage,
            variables: templateVariables || [],
            headerType,
            headerLink,
          })
        : messageType === 'pix'
          ? await sendPixOrFallback({
              adapter,
              channel,
              to: conversation.contactPhoneNumber,
              pixCode: content,
              metadata: metadata || {},
            })
          : messageType && messageType !== 'text'
            ? await adapter.sendMediaMessage(channel, conversation.contactPhoneNumber, {
                messageType,
                mediaPath,
                mediaMimeType,
                mediaFilename,
                caption: content,
                ...(isVoiceNote ? { isVoiceNote: true } : {}),
                ...(replyOptions || {}),
              })
            : replyOptions
              ? await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content, replyOptions)
              : await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content);
      // Antes de recordMessageSent de propósito: é ele que emite a mensagem para
      // o chat, e ela precisa sair já com a marca da queda - senão o atendente vê
      // a bolha de cartão para um Pix que saiu como texto.
      if (messageType === 'pix' && viaCartao === false) {
        await markPixFallbackSent(messageId, motivoTexto);
      }
      const message = await recordMessageSent(messageId, whatsappMessageId);
      avisarTela(conversation, conversationId, message);
      if (channel.type === 'baileys' && messageType === 'audio' && whatsappMessageId) {
        scheduleAudioDeliveryCheck({ channel, whatsappMessageId, conversation, mediaPath, mediaMimeType, mediaFilename, isVoiceNote });
      }
      // So faz sentido conferir o que saiu como cartao: o que ja caiu para texto
      // nao tem para onde cair.
      if (channel.type === 'baileys' && messageType === 'pix' && viaCartao) {
        schedulePixDeliveryCheck({ messageId, conversation, channel, pixCode: content, metadata });
      }
    } catch (err) {
      // mensagemSegura + detalheDaApi: mesma disciplina do log do cartão de Pix logo
      // acima - nunca o conteúdo da mensagem, nunca o corpo da requisição.
      console.error(`Outbound message ${messageId} failed on channel ${channel.id}: ${mensagemSegura(err)}${detalheDaApi(err)}`);
      const motivo = motivoDaResposta(err.response && err.response.data) || mensagemSegura(err);
      // Se markMessageFailed voltar null é porque o webhook de status já gravou um
      // motivoFalha antes (ver a guarda em message.repository) - busca a linha atual
      // para o emit não sair sem mensagem nenhuma.
      const message = (await markMessageFailed(messageId, motivo)) || (await findMessageById(messageId));
      avisarTela(conversation, conversationId, message);
      throw err;
    }
  });
}

module.exports = { startOutboundWorker, sendPixOrFallback };
