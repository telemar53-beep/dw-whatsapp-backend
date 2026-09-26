const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const {
  findOpenConversation, createConversation, getConversationWithContact, activateConversation, markBusinessHoursNoticeSent,
  findRecentAiClosedConversation,
} = require('./conversation.repository');
const { ehMensagemDeCortesia } = require('./courtesy-message');
const { getCompanyConfig } = require('../company/company-config.repository');

// Janela de cortesia depois de um encerramento pela IA: um "obrigado" ou
// "ótimo dia pra você também" que chega neste intervalo fica no histórico da
// conversa encerrada, sem abrir atendimento novo (teste real 2026-09-13: a
// resposta educada do cliente virou uma triagem nova que encaminhou para o
// Suporte). Fixa de propósito — 30 min cobre a troca de gentilezas e não
// segura um pedido de verdade, que de qualquer jeito não passa no filtro.
const JANELA_DE_CORTESIA_MS = 30 * 60 * 1000;
const { enqueueMediaCompression } = require('../queue/media-compression-queue');
const { createMessage, findMessageByWhatsappMessageId, findAutoReplyContext } = require('./message.repository');
const { classificarAutorresposta } = require('./probable-auto-reply');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { enviarAvisoDeCidadeSePreciso } = require('../city-notices/city-notice.service');
const { getBusinessHoursConfig } = require('../business-hours/business-hours.repository');
const { isOutsideBusinessHours } = require('../business-hours/business-hours.service');
const {
  shouldRunAi, scheduleAiReply, shouldTranscribe, markTranscriptionScheduled, enqueueTranscriptionJob,
  shouldStartAiTriage, scheduleAiTriage, isNightModeActiveForChannel,
} = require('../ai/ai.service');
const { getAiConfig } = require('../ai/ai-config.repository');
const { enqueueTriageTimeout } = require('../queue/ai-queue');
const { mensagemSegura } = require('../ai/safe-error-log');

const UNIQUE_VIOLATION = '23505';

// created_at guarda COALESCE(sentAt, now()) e o valor CRU do provedor era
// jogado fora, então o banco não sabia responder a pergunta que interessa
// quando uma hora aparece errada no chat: o provedor mandou errado, ou nós
// transformamos errado? Os três adaptadores convergem em ingestInboundMessage,
// então a metadata é montada num lugar só - aqui.
//
// Só o timestamp e a origem: nada de conteúdo do cliente. E a semântica de
// created_at não muda em nada por causa disto.
const TAMANHO_MAXIMO_DO_CRU = 200;

// O Baileys entrega messageTimestamp como number, texto ou Long ({ low, high }).
// Primitivo vai como veio (é exatamente isso que se quer conferir depois);
// qualquer objeto vira texto curto, para a metadata não crescer sem limite.
function valorCru(valor) {
  if (valor === undefined || valor === null) return null;
  const tipo = typeof valor;
  if (tipo === 'number' || tipo === 'string' || tipo === 'boolean') return valor;
  try {
    return JSON.stringify(valor).slice(0, TAMANHO_MAXIMO_DO_CRU);
  } catch (err) {
    return String(valor).slice(0, TAMANHO_MAXIMO_DO_CRU);
  }
}

// Devolve undefined - e não null - quando o chamador não declarou a origem:
// assim createMessage recebe exatamente o que recebia antes, e quem ingere por
// outro caminho não ganha metadata inventada.
function metadataDoTimestamp({ base, sentAt, sentAtRaw, timestampSource }) {
  if (!timestampSource) return base || undefined;
  const parsed = sentAt instanceof Date && Number.isFinite(sentAt.getTime()) ? sentAt.toISOString() : null;
  // Mescla em vez de substituir: messages.metadata já é usada para outras
  // coisas (motivoFalha, no outbound) e inbound não pode passar por cima.
  return {
    ...(base || {}),
    providerTimestampRaw: valorCru(sentAtRaw),
    providerTimestampParsed: parsed,
    timestampSource,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Fase 1C: lê o contexto e classifica (probable-auto-reply.js). O filtro barato antes da consulta
 * — conversa aberta, sem atendente, texto — só evita ir ao banco à toa; a regra inteira está no
 * classificador. Qualquer erro vira "não suprime": na dúvida, o fluxo normal.
 */
async function classificarSeAutorresposta({ conversation, contact, content, messageType, repliedToWhatsappMessageId }) {
  const tipo = messageType || 'text'; // o mesmo padrão de createMessage
  if (!conversation || conversation.assignedAgentId || tipo !== 'text') return { suprimir: false };
  try {
    const contexto = (await findAutoReplyContext(conversation.id, contact.id)) || {};
    return classificarAutorresposta({
      mensagem: { tipo, texto: content, citada: Boolean(repliedToWhatsappMessageId), recebidaEm: Date.now() },
      atendenteId: conversation.assignedAgentId,
      disparo: contexto.disparo || null,
      depoisDoDisparo: contexto.depoisDoDisparo || [],
      anteriores: contexto.anteriores || [],
    });
  } catch (err) {
    console.error(`Failed to classify probable auto-reply for conversation ${conversation.id}: ${mensagemSegura(err)}`);
    return { suprimir: false };
  }
}

async function ingestInboundMessage({
  channelId,
  fromPhoneNumber,
  contactDisplayName,
  whatsappMessageId,
  content,
  messageType,
  mediaPath,
  mediaMimeType,
  mediaFilename,
  locationLatitude,
  locationLongitude,
  audioDurationSeconds,
  repliedToWhatsappMessageId,
  // A hora que o provedor informou. Ausente cai no now() da gravacao.
  sentAt,
  // O valor CRU do provedor, antes de virar Date, e qual adaptador o entregou.
  // Só vão para messages.metadata (observabilidade); created_at não muda.
  sentAtRaw,
  timestampSource,
}) {
  const metadataDeTempo = metadataDoTimestamp({ sentAt, sentAtRaw, timestampSource });
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  const contactJustCreated = Boolean(wasCreated);

  let businessHoursConfig = { enabled: false, startTime: '08:00', endTime: '18:00', message: '' };
  let outsideBusinessHours = false;
  try {
    businessHoursConfig = await getBusinessHoursConfig();
    outsideBusinessHours = businessHoursConfig.enabled && isOutsideBusinessHours(businessHoursConfig);
  } catch (err) {
    console.error('Failed to load business hours config', err);
  }

  let conversation = await findOpenConversation(contact.id, channelId);

  // Fase 1C (25/09/2026): autorresposta provável do destinatário depois de um disparo
  // automático (caso real: "Restaurante sabor caseiro agradece seu contato. Como podemos
  // ajudar?", e a IA respondia ao robô). Decidido ANTES de ativar a conversa: marcada, ela fica
  // no histórico e nada reage — nem IA, nem triagem, nem fila, nem boas-vindas, aviso de cidade
  // ou de horário; a conversa silent continua silent. Na dúvida (inclusive erro), fluxo normal.
  const autorresposta = await classificarSeAutorresposta({ conversation, contact, content, messageType, repliedToWhatsappMessageId });
  if (autorresposta.suprimir) {
    let message = null;
    try {
      message = await createMessage({
        conversationId: conversation.id,
        direction: 'inbound',
        content,
        whatsappMessageId,
        status: 'received',
        messageType,
        sentAt,
        metadata: { ...(metadataDeTempo || {}), autorrespostaProvavel: true, autorrespostaMotivo: autorresposta.motivo },
      });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
    }
    return { contact, conversation, message, contactJustCreated, autorresposta: true };
  }

  if (conversation && conversation.status === 'silent') {
    conversation = await activateConversation(conversation.id);
  }
  let justCreated = false;
  // Hoisted para fora do bloco `if (!conversation)`: reaproveitado mais abaixo
  // (triagemIa) para não chamar shouldStartAiTriage duas vezes quando a
  // conversa acabou de nascer.
  let aiTriage = false;
  if (!conversation) {
    // Só busca a config da empresa neste caminho (sem conversa aberta): a
    // maioria das mensagens chega dentro de uma conversa já existente, e ali
    // ehMensagemDeCortesia nem é chamada — não vale acrescentar leitura de
    // banco ao caminho quente de toda mensagem recebida. Falha aqui não pode
    // derrubar a ingestão: segue sem o nome, que é opcional.
    let nomeDaEmpresa;
    try {
      ({ name: nomeDaEmpresa } = await getCompanyConfig());
    } catch (err) {
      console.error('Failed to load company config for courtesy check', err);
    }
    if (ehMensagemDeCortesia({ content, messageType, nomeDaEmpresa })) {
      const encerradaPelaIa = await findRecentAiClosedConversation(contact.id, channelId, JANELA_DE_CORTESIA_MS);
      if (encerradaPelaIa) {
        // Só o histórico: a conversa continua encerrada, ninguém é avisado e
        // nada responde — para "pra você também", silêncio é a resposta certa.
        let message = null;
        try {
          message = await createMessage({
            conversationId: encerradaPelaIa.id,
            direction: 'inbound',
            content,
            whatsappMessageId,
            status: 'received',
            messageType,
            mediaPath,
            mediaMimeType,
            mediaFilename,
            sentAt,
            metadata: metadataDeTempo,
          });
        } catch (err) {
          if (err.code !== UNIQUE_VIOLATION) throw err;
        }
        return { contact, conversation: encerradaPelaIa, message, contactJustCreated, cortesia: true };
      }
    }
  }
  if (!conversation) {
    // Triagem por IA tem prioridade sobre a triagem numérica: um canal nunca
    // roda as duas ao mesmo tempo (shouldStartAiTriage já confere aiEnabled +
    // aiTriageEnabled + shouldRunAi).
    aiTriage = await shouldStartAiTriage(channelId);
    const startTriage = !aiTriage && !outsideBusinessHours && (await shouldStartTriage(channelId));
    try {
      conversation = await createConversation(contact.id, channelId, aiTriage || startTriage ? 'pending' : null);
      justCreated = true;
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      conversation = await findOpenConversation(contact.id, channelId);
    }
  }

  // I2 (fix round 1): fora do try/catch de createConversation de propósito.
  // Aquele catch só perdoa 23505 (corrida de criação) e relança qualquer
  // outro erro — um enqueueTriageTimeout (Redis) ou getAiConfig (Postgres)
  // que falhasse ali dentro faria o erro subir e a mensagem do cliente NUNCA
  // ser persistida (createMessage, mais abaixo, nem seria alcançado), mesmo a
  // conversa já tendo sido criada. Aqui, uma falha só loga — a conversa já
  // nasceu 'pending' e o pior caso é depender só da triagem por IA responder
  // no prazo normal, sem o job de segurança.
  if (justCreated && aiTriage) {
    try {
      const cfg = await getAiConfig();
      await enqueueTriageTimeout({ conversationId: conversation.id, delayMs: (cfg.triageTimeoutMinutes || 3) * 60000 });
    } catch (err) {
      console.error(`Failed to schedule triage timeout for conversation ${conversation.id}: ${mensagemSegura(err)}`);
    }
  }
  // Resolve a mensagem citada (se houver) antes de gravar: o id que o cliente
  // ecoou é o whatsapp_message_id de uma mensagem NOSSA, então a busca é
  // sempre escopada a esta conversa. Uma citação que não resolve — mensagem
  // que nunca guardamos, de outra conversa, uma notificação de status que não
  // é mensagem de verdade — é ignorada em silêncio: a mensagem do cliente é
  // gravada normalmente, sem citação, exatamente como sempre foi antes desta
  // função existir. A busca nunca pode derrubar a ingestão.
  let repliedTo = null;
  if (repliedToWhatsappMessageId) {
    try {
      repliedTo = await findMessageByWhatsappMessageId(conversation.id, repliedToWhatsappMessageId);
    } catch (err) {
      console.error(`Failed to resolve quoted message for conversation ${conversation.id}: ${mensagemSegura(err)}`);
    }
  }
  const repliedToPreview = repliedTo ? { content: repliedTo.content, direction: repliedTo.direction } : null;

  let message;
  try {
    message = await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content,
      whatsappMessageId,
      status: 'received',
      messageType,
      mediaPath,
      mediaMimeType,
      mediaFilename,
      locationLatitude,
      locationLongitude,
      repliedToMessageId: repliedTo ? repliedTo.id : null,
      sentAt,
      metadata: metadataDeTempo,
    });
    // Comprimir vídeo leva segundos a minutos: fica fora do webhook, que
    // precisa responder rápido ao provedor. O original já está gravado e a
    // mensagem já vai aparecer no chat; o worker troca o arquivo depois.
    if (message && message.messageType === 'video') {
      await enqueueMediaCompression({ messageId: message.id });
    }
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) throw err;
    return { contact, conversation, message: null, contactJustCreated };
  }
  // createMessage devolve a linha crua, sem o JOIN que listMessagesByConversation
  // faz para montar repliedToPreview — sem isso aqui, quem está com o chat
  // aberto só veria a citação depois de recarregar a lista inteira.
  if (repliedToPreview) {
    message = { ...message, repliedToPreview };
  }
  if (justCreated) {
    try {
      const channel = await findChannelById(channelId);
      if (channel && channel.welcomeMessage) {
        await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: channel.welcomeMessage });
      }
    } catch (err) {
      console.error(`Failed to send welcome message for conversation ${conversation.id}`, err);
    }
  }

  try {
    await enviarAvisoDeCidadeSePreciso({ contact, conversationId: conversation.id, channelId });
  } catch (err) {
    console.error(`Failed to send city notice for conversation ${conversation.id}`, err);
  }

  // Com o modo noturno ativo no canal, quem fala primeiro é a IA — o aviso
  // de "estamos fora do horário" contradiria a resposta que vem em seguida.
  const noturnoAtivo = outsideBusinessHours ? await isNightModeActiveForChannel(channelId) : false;
  if (outsideBusinessHours && !noturnoAtivo && !conversation.businessHoursNoticeSentAt && !conversation.assignedAgentId) {
    try {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: businessHoursConfig.message });
      conversation = await markBusinessHoursNoticeSent(conversation.id);
    } catch (err) {
      console.error(`Failed to send business hours notice for conversation ${conversation.id}`, err);
    }
  }

  // Reaproveita `aiTriage` (computado no bloco de criação) quando a conversa
  // acabou de nascer, em vez de chamar shouldStartAiTriage de novo — mas essa
  // checagem também precisa valer numa conversa que já existia (triagem por
  // IA de uma conversa reaberta não passa pelo bloco `!conversation`), daí o
  // fallback para o `justCreated ? false : ...` não servir: só pulamos a
  // segunda chamada quando `justCreated` é true.
  const triagemIa = conversation.triageState === 'pending'
    && (justCreated ? aiTriage : await shouldStartAiTriage(channelId));
  if (justCreated) {
    try {
      if (conversation.triageState === 'pending' && !triagemIa) {
        await sendTriageQuestion(conversation.id, channelId);
      }
    } catch (err) {
      console.error(`Failed to start triage for conversation ${conversation.id}`, err);
    }
  } else if (conversation.triageState === 'pending' && !triagemIa) {
    conversation = await processTriageReply(conversation, channelId, content);
  }

  // Gate no tipo antes de tocar o banco: sem ele, shouldTranscribe (2 queries)
  // rodaria para toda mensagem de texto/figurinha/localização, mesmo com a
  // funcionalidade desligada — quebrando a garantia de "desligado é transparente".
  let audioTranscriptionScheduled = false;
  try {
    if (message.messageType === 'audio' && (await shouldTranscribe(channelId))) {
      audioTranscriptionScheduled = true;
      const updated = await markTranscriptionScheduled(message, audioDurationSeconds);
      // markTranscriptionScheduled devolve a linha do banco (sem o JOIN da
      // citação): reaplica repliedToPreview por cima para o áudio transcrito
      // não perder a citação que acabou de ganhar, alguns passos acima.
      if (updated) message = repliedToPreview ? { ...updated, repliedToPreview } : updated;
    }
  } catch (err) {
    console.error(`Failed to schedule transcription for conversation ${conversation.id}`, err);
  }

  try {
    if (triagemIa) {
      await scheduleAiTriage(conversation, message);
    } else if (await shouldRunAi(channelId)) {
      await scheduleAiReply(conversation, message);
    }
  } catch (err) {
    console.error(`Failed to schedule AI reply for conversation ${conversation.id}`, err);
  }

  const conversationWithContact = await getConversationWithContact(conversation.id);
  if (conversationWithContact.assignedAgentId) {
    emitToAgent(conversationWithContact.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });

  // Só depois do emit: um job pego pelo worker antes disso pode publicar
  // message:transcription antes de a tela saber que a mensagem existe.
  if (audioTranscriptionScheduled) {
    try {
      await enqueueTranscriptionJob(conversation, message);
    } catch (err) {
      console.error(`Failed to enqueue transcription for conversation ${conversation.id}`, err);
    }
  }

  return { contact, conversation, message, contactJustCreated };
}

module.exports = { ingestInboundMessage };
