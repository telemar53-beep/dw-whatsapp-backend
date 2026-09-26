const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createConversation } = require('./conversation.repository');
const {
  createMessage,
  updateMessageStatus,
  recordMessageSent,
  listMessagesByConversation,
  listRecentMessagesByConversation,
  findMessageById,
  findMessageByWhatsappMessageId,
  advanceMessageStatus,
  findLatestInboundMessageId,
  findLatestInboundImage,
  markTranscriptionPending,
  markTranscriptionProcessing,
  saveTranscription,
  markTranscriptionFailed,
  markPixFallbackSent,
  markMessageFailed,
  markMessageFailedByWhatsappId,
  updateMessageMedia,
  listExpiredMedia,
  clearMessageMedia,
  recordMessageWaId,
  findLastMessageCreatedAt,
  findAutoReplyContext,
} = require('./message.repository');

describe('message repository', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, messages CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511966665555', 'Ana');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste 2',
      phoneNumber: '+5511999990010',
      config: { phoneNumberId: '222', accessToken: 'tok2' },
    });
    const conversation = await createConversation(contact.id, channel.id);
    conversationId = conversation.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('createMessage stores an inbound text message with messageType defaulting to text', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Oi, preciso de ajuda',
      whatsappMessageId: 'wamid.ABC123',
      status: 'received',
    });
    expect(message.id).toBeDefined();
    expect(message.direction).toBe('inbound');
    expect(message.status).toBe('received');
    expect(message.messageType).toBe('text');
    expect(message.mediaPath).toBeNull();
  });

  test('createMessage stores an image message with a caption and media fields', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Aqui está o comprovante',
      whatsappMessageId: 'wamid.IMG1',
      status: 'received',
      messageType: 'image',
      mediaPath: 'abc123.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    });
    expect(message.messageType).toBe('image');
    expect(message.mediaPath).toBe('abc123.jpg');
    expect(message.mediaMimeType).toBe('image/jpeg');
    expect(message.content).toBe('Aqui está o comprovante');
  });

  test('createMessage stores a message with no content when there is no caption', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.AUD1',
      status: 'received',
      messageType: 'audio',
      mediaPath: 'def456.ogg',
      mediaMimeType: 'audio/ogg',
    });
    expect(message.content).toBeNull();
    expect(message.messageType).toBe('audio');
  });

  test('createMessage stores a location message with coordinates and no media', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.LOC1',
      status: 'received',
      messageType: 'location',
      locationLatitude: -3.119,
      locationLongitude: -60.021,
    });
    expect(message.messageType).toBe('location');
    expect(message.locationLatitude).toBe(-3.119);
    expect(message.locationLongitude).toBe(-60.021);
    expect(message.mediaPath).toBeNull();
  });

  test('updateMessageStatus changes the status', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Resposta',
      whatsappMessageId: null,
      status: 'sent',
    });
    const updated = await updateMessageStatus(message.id, 'failed');
    expect(updated.status).toBe('failed');
  });

  test('recordMessageSent sets the whatsapp message id', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Resposta',
      whatsappMessageId: null,
      status: 'sent',
    });
    const updated = await recordMessageSent(message.id, 'wamid.OUT1');
    expect(updated.whatsappMessageId).toBe('wamid.OUT1');
  });

  test('listMessagesByConversation returns messages in chronological order', async () => {
    await createMessage({ conversationId, direction: 'inbound', content: 'primeira', whatsappMessageId: 'wamid.1', status: 'received' });
    await createMessage({ conversationId, direction: 'outbound', content: 'segunda', whatsappMessageId: null, status: 'sent' });
    const messages = await listMessagesByConversation(conversationId);
    expect(messages.map((m) => m.content)).toEqual(['primeira', 'segunda']);
  });

  test('listMessagesByConversation reports which messages were authored by the AI', async () => {
    // The join list on this query is written out inline (not via MESSAGE_COLUMNS), so it is
    // easy to add sent_by to the column elsewhere and still leave the attendant's own
    // conversation view unable to tell an AI-authored message from a human one.
    await createMessage({
      conversationId, direction: 'outbound', content: 'Sugestão da IA', whatsappMessageId: null, status: 'sent', sentBy: 'ai',
    });
    await createMessage({
      conversationId, direction: 'outbound', content: 'Resposta humana', whatsappMessageId: null, status: 'sent',
    });

    const messages = await listMessagesByConversation(conversationId);

    expect(messages.find((m) => m.content === 'Sugestão da IA').sentBy).toBe('ai');
    expect(messages.find((m) => m.content === 'Resposta humana').sentBy).toBe('human');
  });

  describe('listRecentMessagesByConversation', () => {
    test('returns only the newest messages, in chronological order', async () => {
      // 5 mensagens, mas o atendimento só pode ver as 3 mais novas: se a
      // consulta usasse ORDER BY created_at ASC LIMIT 3 (o erro que a IA
      // cometeria se lesse a mais antiga em vez da mais recente), o resultado
      // seria ['m1', 'm2', 'm3'] em vez de ['m3', 'm4', 'm5'].
      await createMessage({ conversationId, direction: 'inbound', content: 'm1', whatsappMessageId: 'wamid.REC1', status: 'received' });
      await createMessage({ conversationId, direction: 'outbound', content: 'm2', whatsappMessageId: null, status: 'sent' });
      await createMessage({ conversationId, direction: 'inbound', content: 'm3', whatsappMessageId: 'wamid.REC3', status: 'received' });
      await createMessage({ conversationId, direction: 'outbound', content: 'm4', whatsappMessageId: null, status: 'sent' });
      await createMessage({ conversationId, direction: 'inbound', content: 'm5', whatsappMessageId: 'wamid.REC5', status: 'received' });

      const messages = await listRecentMessagesByConversation(conversationId, 3);

      expect(messages.map((m) => m.content)).toEqual(['m3', 'm4', 'm5']);
    });
  });

  test('findMessageById returns the message with its media fields', async () => {
    const created = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.DOC1',
      status: 'received',
      messageType: 'document',
      mediaPath: 'ghi789.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'comprovante.pdf',
    });
    const found = await findMessageById(created.id);
    expect(found.mediaPath).toBe('ghi789.pdf');
    expect(found.mediaFilename).toBe('comprovante.pdf');
  });

  describe('mensagem de Pix com metadata', () => {
    test('createMessage grava messageType pix com metadata e findMessageById devolve de volta', async () => {
      const created = await createMessage({
        conversationId,
        direction: 'outbound',
        content: '00020126580014BR.GOV.BCB.PIX0136chave-pix',
        status: 'sent',
        messageType: 'pix',
        metadata: { value: 135, dueDate: '2026-09-15', faturaId: 999 },
      });
      expect(created.messageType).toBe('pix');
      expect(created.metadata).toEqual({ value: 135, dueDate: '2026-09-15', faturaId: 999 });
      const found = await findMessageById(created.id);
      expect(found.metadata).toEqual({ value: 135, dueDate: '2026-09-15', faturaId: 999 });
    });

    test('a metadata chega pela listagem da conversa, não só pelo RETURNING', async () => {
      await createMessage({
        conversationId,
        direction: 'outbound',
        content: '00020126580014BR.GOV.BCB.PIX0136chave-pix',
        status: 'sent',
        messageType: 'pix',
        metadata: { value: 135, dueDate: '2026-09-15', faturaId: 999 },
      });
      const lista = await listMessagesByConversation(conversationId);
      expect(lista[0].metadata).toEqual({ value: 135, dueDate: '2026-09-15', faturaId: 999 });
      const recentes = await listRecentMessagesByConversation(conversationId, 10);
      expect(recentes[0].metadata).toEqual({ value: 135, dueDate: '2026-09-15', faturaId: 999 });
    });

    test('markPixFallbackSent marca a queda uma vez só e preserva a metadata', async () => {
      const created = await createMessage({
        conversationId,
        direction: 'outbound',
        content: '00020126580014BR.GOV.BCB.PIX0136chave-pix',
        status: 'sent',
        messageType: 'pix',
        metadata: { value: 135, dueDate: '2026-09-15', faturaId: 999 },
      });

      await expect(markPixFallbackSent(created.id, 'cartao_nao_entregue')).resolves.toBe(true);
      // Uma segunda passada (retry da fila, restart do worker) não pode
      // duplicar as mensagens de texto - nem reescrever o motivo do primeiro
      // desfecho, que é o que o chat mostra ao atendente.
      await expect(markPixFallbackSent(created.id, 'codigo_sem_chave')).resolves.toBe(false);

      const found = await findMessageById(created.id);
      expect(found.metadata).toEqual({
        value: 135,
        dueDate: '2026-09-15',
        faturaId: 999,
        fallbackTextoEnviado: true,
        motivoTexto: 'cartao_nao_entregue',
      });
    });

    test('markPixFallbackSent funciona em mensagem sem metadata nenhuma', async () => {
      const created = await createMessage({
        conversationId,
        direction: 'outbound',
        content: 'Oi',
        status: 'sent',
      });
      await expect(markPixFallbackSent(created.id, 'codigo_sem_chave')).resolves.toBe(true);
      const found = await findMessageById(created.id);
      expect(found.metadata).toEqual({ fallbackTextoEnviado: true, motivoTexto: 'codigo_sem_chave' });
    });

    test('metadata é null quando a mensagem não tem nenhuma', async () => {
      const created = await createMessage({
        conversationId,
        direction: 'inbound',
        content: 'Oi',
        status: 'received',
      });
      expect(created.metadata).toBeNull();
    });
  });

  test('findMessageById returns null when not found', async () => {
    const found = await findMessageById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });

  test('createMessage stores a reply reference when repliedToMessageId is provided', async () => {
    const original = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Qual o valor da fatura?',
      whatsappMessageId: 'wamid.ORIG1',
      status: 'received',
    });
    const reply = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'R$150,00',
      whatsappMessageId: null,
      status: 'sent',
      repliedToMessageId: original.id,
    });
    expect(reply.repliedToMessageId).toBe(original.id);
  });

  describe('findMessageByWhatsappMessageId', () => {
    test('returns the message with that whatsapp_message_id in the conversation', async () => {
      const created = await createMessage({
        conversationId,
        direction: 'inbound',
        content: 'Qual o valor da fatura?',
        whatsappMessageId: 'wamid.QUOTED1',
        status: 'received',
      });

      const found = await findMessageByWhatsappMessageId(conversationId, 'wamid.QUOTED1');

      expect(found.id).toBe(created.id);
      expect(found.content).toBe('Qual o valor da fatura?');
    });

    test('returns null when no message in the conversation has that whatsapp_message_id', async () => {
      const found = await findMessageByWhatsappMessageId(conversationId, 'wamid.DOES-NOT-EXIST');
      expect(found).toBeNull();
    });

    test('does not resolve a whatsapp_message_id that belongs to a different conversation', async () => {
      const contact2 = await findOrCreateContactByPhoneNumber('+5511977776666', 'Bia');
      const channel2 = await createChannel({
        type: 'meta_cloud',
        name: 'Canal Teste 3',
        phoneNumber: '+5511999990020',
        config: { phoneNumberId: '333', accessToken: 'tok3' },
      });
      const otherConversation = await createConversation(contact2.id, channel2.id);
      await createMessage({
        conversationId: otherConversation.id,
        direction: 'inbound',
        content: 'Mensagem de outra conversa',
        whatsappMessageId: 'wamid.OTHERCONV1',
        status: 'received',
      });

      const found = await findMessageByWhatsappMessageId(conversationId, 'wamid.OTHERCONV1');

      expect(found).toBeNull();
    });
  });

  test('createMessage leaves repliedToMessageId null when not provided', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Oi',
      whatsappMessageId: 'wamid.NOREPLY1',
      status: 'received',
    });
    expect(message.repliedToMessageId).toBeNull();
  });

  // Paginacao aditiva: sem opcoes a consulta e a de antes. Com `limit`, traz as
  // MAIS NOVAS; com `before`, o trecho anterior a uma mensagem conhecida.
  describe('listMessagesByConversation paginado', () => {
    async function criarSequencia(n) {
      const criadas = [];
      for (let i = 0; i < n; i += 1) {
        // sentAt crescente: sem isso todas nascem no mesmo instante e a ordem
        // passa a depender so do desempate por id.
        criadas.push(await createMessage({
          conversationId, direction: 'inbound', status: 'received', content: `msg ${i}`,
          sentAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
        }));
      }
      return criadas;
    }

    test('sem opcoes, devolve tudo em ordem crescente, como antes', async () => {
      await criarSequencia(5);
      const todas = await listMessagesByConversation(conversationId);
      expect(todas.map((m) => m.content)).toEqual(['msg 0', 'msg 1', 'msg 2', 'msg 3', 'msg 4']);
    });

    // O ponto da paginacao: quem abre a conversa quer o fim do historico, nao
    // o comeco. Um LIMIT sobre a ordem crescente traria 'msg 0'.
    test('com limit, devolve as MAIS NOVAS, ainda em ordem crescente', async () => {
      await criarSequencia(5);
      const pagina = await listMessagesByConversation(conversationId, { limit: 2 });
      expect(pagina.map((m) => m.content)).toEqual(['msg 3', 'msg 4']);
    });

    test('before traz o trecho anterior, sem repetir o cursor', async () => {
      const criadas = await criarSequencia(5);
      const pagina = await listMessagesByConversation(conversationId, { limit: 2, before: criadas[3].id });
      expect(pagina.map((m) => m.content)).toEqual(['msg 1', 'msg 2']);
    });

    test('no comeco do historico, before devolve menos que o limite', async () => {
      const criadas = await criarSequencia(3);
      const pagina = await listMessagesByConversation(conversationId, { limit: 10, before: criadas[1].id });
      expect(pagina.map((m) => m.content)).toEqual(['msg 0']);
    });

    // Duas mensagens no MESMO instante acontecem de verdade: mensagem do
    // cliente e resposta automatica. Um cursor so por data pularia ou
    // repetiria uma delas; o par (created_at, id) nao.
    test('empate de horario nao pula nem repete mensagem', async () => {
      const instante = new Date(Date.UTC(2026, 0, 1, 12, 0));
      const a = await createMessage({ conversationId, direction: 'inbound', status: 'received', content: 'A', sentAt: instante });
      const b = await createMessage({ conversationId, direction: 'outbound', status: 'sent', content: 'B', sentAt: instante });
      const primeiras = await listMessagesByConversation(conversationId, { limit: 1 });
      expect(primeiras).toHaveLength(1);
      const anteriores = await listMessagesByConversation(conversationId, { limit: 5, before: primeiras[0].id });
      const vistas = [...anteriores, ...primeiras].map((m) => m.content);
      expect(vistas).toHaveLength(2);
      expect(new Set(vistas)).toEqual(new Set([a.content, b.content]));
    });
  });

  describe('listMessagesByConversation reply previews', () => {
    test('includes a repliedToPreview for a message that replies to another', async () => {
      const original = await createMessage({
        conversationId,
        direction: 'inbound',
        content: 'Qual o valor da fatura?',
        whatsappMessageId: 'wamid.ORIG2',
        status: 'received',
      });
      await createMessage({
        conversationId,
        direction: 'outbound',
        content: 'R$150,00',
        whatsappMessageId: null,
        status: 'sent',
        repliedToMessageId: original.id,
      });

      const messages = await listMessagesByConversation(conversationId);
      const replyMessage = messages.find((m) => m.content === 'R$150,00');

      expect(replyMessage.repliedToPreview).toEqual({
        content: 'Qual o valor da fatura?',
        direction: 'inbound',
      });
    });

    test('repliedToPreview is null for a message that does not reply to anything', async () => {
      await createMessage({
        conversationId,
        direction: 'inbound',
        content: 'Mensagem solta',
        whatsappMessageId: 'wamid.SOLTA1',
        status: 'received',
      });

      const messages = await listMessagesByConversation(conversationId);
      const message = messages.find((m) => m.content === 'Mensagem solta');

      expect(message.repliedToPreview).toBeNull();
    });
  });

  // Fase 1A (25/09/2026): o wa_id que a Meta devolve no envio fica registrado na própria
  // mensagem do disparo, sem apagar o que já estava na metadata.
  // Caso ER (25/09/2026): o timeout da triagem relê a última atividade da conversa antes de
  // agir. Atividade é QUALQUER mensagem — do cliente ou da IA.
  // Fase 1C (25/09/2026): o contexto que o classificador de autorresposta precisa, lido numa
  // passada: o disparo automático mais recente da conversa, o que veio depois dele e as
  // autorrespostas já marcadas do contato.
  describe('findAutoReplyContext', () => {
    let contactId;
    beforeEach(async () => {
      contactId = (await findOrCreateContactByPhoneNumber('+5511966665555', null)).id;
    });
    const em = (iso) => new Date(iso);

    test('sem disparo automático na conversa: disparo null e nada mais é lido', async () => {
      await createMessage({ conversationId, direction: 'outbound', content: 'oi', status: 'sent', sentBy: 'human', sentAt: em('2026-09-25T15:00:00Z') });
      expect(await findAutoReplyContext(conversationId, contactId)).toEqual({ disparo: null, depoisDoDisparo: [], anteriores: [] });
    });

    test('o disparo mais recente (sgp ou campanha) e o que veio depois dele, com as marcas', async () => {
      await createMessage({ conversationId, direction: 'outbound', content: 'antigo', status: 'sent', metadata: { origem: 'campanha', campanhaId: 'c1' }, sentAt: em('2026-09-25T14:00:00Z') });
      await createMessage({ conversationId, direction: 'inbound', content: 'antes', status: 'received', sentAt: em('2026-09-25T14:30:00Z') });
      await createMessage({ conversationId, direction: 'outbound', content: 'Olá, Maria', status: 'sent', metadata: { origem: 'sgp', modo: 'template', template: 't' }, sentAt: em('2026-09-25T15:00:00Z') });
      await createMessage({ conversationId, direction: 'inbound', content: 'Estamos fechados.', status: 'received', metadata: { autorrespostaProvavel: true, autorrespostaMotivo: 'janela_padrao_forte' }, sentAt: em('2026-09-25T15:00:20Z') });
      await createMessage({ conversationId, direction: 'inbound', content: 'oi', status: 'received', sentAt: em('2026-09-25T15:01:00Z') });
      await createMessage({ conversationId, direction: 'outbound', content: 'resposta', status: 'sent', sentBy: 'ai', sentAt: em('2026-09-25T15:01:10Z') });

      const ctx = await findAutoReplyContext(conversationId, contactId);
      expect(ctx.disparo).toEqual({ origem: 'sgp', modo: 'template', criadoEm: em('2026-09-25T15:00:00Z') });
      expect(ctx.depoisDoDisparo).toEqual([
        { direcao: 'inbound', autorresposta: true, automatica: false },
        { direcao: 'inbound', autorresposta: false, automatica: false },
        { direcao: 'outbound', autorresposta: false, automatica: false },
      ]);
    });

    test('autorrespostas anteriores: só as marcadas, de qualquer conversa do contato, com o motivo', async () => {
      await createMessage({ conversationId, direction: 'outbound', content: 'x', status: 'sent', metadata: { origem: 'sgp', modo: 'template' }, sentAt: em('2026-09-25T15:00:00Z') });
      await createMessage({ conversationId, direction: 'inbound', content: 'Estamos fechados agora mesmo.', status: 'received', metadata: { autorrespostaProvavel: true, autorrespostaMotivo: 'janela_padrao_forte' }, sentAt: em('2026-09-25T15:00:20Z') });
      await createMessage({ conversationId, direction: 'inbound', content: 'mensagem normal', status: 'received', sentAt: em('2026-09-25T15:02:00Z') });

      const ctx = await findAutoReplyContext(conversationId, contactId);
      expect(ctx.anteriores).toEqual([{ texto: 'Estamos fechados agora mesmo.', autorresposta: true, motivo: 'janela_padrao_forte' }]);
    });
  });

  describe('findLastMessageCreatedAt', () => {
    test('conversa sem mensagem: null', async () => {
      expect(await findLastMessageCreatedAt(conversationId)).toBeNull();
    });

    test('a mais recente vence, em qualquer direção: resposta da IA depois do cliente', async () => {
      await createMessage({ conversationId, direction: 'inbound', content: 'oi', status: 'received', sentAt: new Date('2026-09-25T16:13:18.000Z') });
      await createMessage({ conversationId, direction: 'outbound', content: 'resposta', status: 'sent', sentBy: 'ai', sentAt: new Date('2026-09-25T16:13:30.000Z') });
      expect((await findLastMessageCreatedAt(conversationId)).toISOString()).toBe('2026-09-25T16:13:30.000Z');
    });

    test('a mais recente vence, em qualquer direção: cliente depois da IA', async () => {
      await createMessage({ conversationId, direction: 'outbound', content: 'resposta', status: 'sent', sentBy: 'ai', sentAt: new Date('2026-09-25T16:13:30.000Z') });
      await createMessage({ conversationId, direction: 'inbound', content: 'oi de novo', status: 'received', sentAt: new Date('2026-09-25T16:15:00.000Z') });
      expect((await findLastMessageCreatedAt(conversationId)).toISOString()).toBe('2026-09-25T16:15:00.000Z');
    });

    test('mensagem de outra conversa não conta', async () => {
      await createMessage({ conversationId, direction: 'inbound', content: 'oi', status: 'received', sentAt: new Date('2026-09-25T16:00:00.000Z') });
      const outroContato = await findOrCreateContactByPhoneNumber('+5511966664444', null);
      const outroCanal = await createChannel({ type: 'meta_cloud', name: 'Outro', phoneNumber: '+5511999990011', config: {} });
      const outra = await createConversation(outroContato.id, outroCanal.id);
      await createMessage({ conversationId: outra.id, direction: 'inbound', content: 'oi', status: 'received', sentAt: new Date('2026-09-25T17:00:00.000Z') });
      expect((await findLastMessageCreatedAt(conversationId)).toISOString()).toBe('2026-09-25T16:00:00.000Z');
    });
  });

  describe('recordMessageWaId', () => {
    test('grava o wa_id na metadata de uma mensagem sem metadata', async () => {
      const msg = await createMessage({ conversationId, direction: 'outbound', content: null, status: 'sent', messageType: 'text' });
      await recordMessageWaId(msg.id, '559885120338');
      expect((await findMessageById(msg.id)).metadata).toEqual({ waId: '559885120338' });
    });

    test('mescla com o que já existe na metadata, sem apagar', async () => {
      const msg = await createMessage({ conversationId, direction: 'outbound', content: null, status: 'sent', messageType: 'text', metadata: { faturaId: '77' } });
      await markMessageFailed(msg.id, '(131047) janela fechada');
      await recordMessageWaId(msg.id, '559885120338');
      expect((await findMessageById(msg.id)).metadata).toEqual({ faturaId: '77', motivoFalha: '(131047) janela fechada', waId: '559885120338' });
    });
  });

  describe('markMessageFailed', () => {
    test('sets status to failed and records the motivo in metadata.motivoFalha', async () => {
      const message = await createMessage({
        conversationId, direction: 'outbound', content: 'Promoção especial', whatsappMessageId: null, status: 'sent',
      });

      const updated = await markMessageFailed(message.id, '(131049) A Meta limitou mensagens de marketing.');

      expect(updated.status).toBe('failed');
      expect(updated.metadata).toEqual({ motivoFalha: '(131049) A Meta limitou mensagens de marketing.' });
    });

    test('merges motivoFalha into existing metadata instead of overwriting it', async () => {
      const message = await createMessage({
        conversationId, direction: 'outbound', content: '00020126580014BR.GOV.BCB.PIX0136chave-pix',
        status: 'sent', messageType: 'pix', metadata: { value: 135, dueDate: '2026-09-15' },
      });

      const updated = await markMessageFailed(message.id, 'algum motivo');

      expect(updated.metadata).toEqual({ value: 135, dueDate: '2026-09-15', motivoFalha: 'algum motivo' });
    });

    test('returns null for an id that does not exist', async () => {
      const updated = await markMessageFailed('00000000-0000-0000-0000-000000000000', 'motivo');
      expect(updated).toBeNull();
    });

    test('does not overwrite a motivoFalha already recorded (e.g. by the status webhook) and returns null', async () => {
      const message = await createMessage({
        conversationId, direction: 'outbound', content: 'Promoção especial', whatsappMessageId: 'wamid.WEBHOOK1',
        status: 'failed', metadata: { motivoFalha: '(131026) Número não recebe mensagens.' },
      });

      const updated = await markMessageFailed(message.id, 'network error');

      expect(updated).toBeNull();
      const stored = await findMessageById(message.id);
      expect(stored.status).toBe('failed');
      expect(stored.metadata).toEqual({ motivoFalha: '(131026) Número não recebe mensagens.' });
    });
  });

  describe('markMessageFailedByWhatsappId', () => {
    test('sets status to failed and records the motivo, keyed by whatsapp_message_id', async () => {
      await createMessage({
        conversationId, direction: 'outbound', content: 'Promoção', whatsappMessageId: 'wamid.FAIL1', status: 'sent',
      });

      const updated = await markMessageFailedByWhatsappId('wamid.FAIL1', '(131026) Número não recebe mensagens.');

      expect(updated.status).toBe('failed');
      expect(updated.metadata).toEqual({ motivoFalha: '(131026) Número não recebe mensagens.' });
    });

    test('does not regress a message that already reached a later status than sent', async () => {
      // Mesma semantica de advanceMessageStatus: 'failed' e o rank mais alto,
      // entao esta guarda so bloqueia quando a mensagem ja esta 'failed' - um
      // segundo webhook de falha (retry da Meta) nao pode sobrescrever o motivo
      // do primeiro.
      await createMessage({
        conversationId, direction: 'outbound', content: 'Promoção', whatsappMessageId: 'wamid.FAIL2', status: 'failed',
      });

      const result = await markMessageFailedByWhatsappId('wamid.FAIL2', 'motivo novo');

      expect(result).toBeNull();
    });

    test('returns null when no message has that whatsapp message id', async () => {
      const result = await markMessageFailedByWhatsappId('wamid.UNKNOWN', 'motivo');
      expect(result).toBeNull();
    });
  });

  describe('advanceMessageStatus', () => {
    test('moves the status forward when found by whatsapp message id', async () => {
      await createMessage({
        conversationId,
        direction: 'outbound',
        content: 'Resposta',
        whatsappMessageId: 'wamid.STATUS1',
        status: 'sent',
      });

      const updated = await advanceMessageStatus('wamid.STATUS1', 'delivered');

      expect(updated.status).toBe('delivered');
    });

    test('advances again from delivered to read', async () => {
      await createMessage({
        conversationId,
        direction: 'outbound',
        content: 'Resposta',
        whatsappMessageId: 'wamid.STATUS2',
        status: 'delivered',
      });

      const updated = await advanceMessageStatus('wamid.STATUS2', 'read');

      expect(updated.status).toBe('read');
    });

    test('ignores an out-of-order status that would move the message backward', async () => {
      await createMessage({
        conversationId,
        direction: 'outbound',
        content: 'Resposta',
        whatsappMessageId: 'wamid.STATUS3',
        status: 'read',
      });

      const result = await advanceMessageStatus('wamid.STATUS3', 'delivered');

      expect(result).toBeNull();
      const stillRead = await findMessageById((await listMessagesByConversation(conversationId))[0].id);
      expect(stillRead.status).toBe('read');
    });

    test('returns null when no message has that whatsapp message id', async () => {
      const result = await advanceMessageStatus('wamid.UNKNOWN', 'delivered');
      expect(result).toBeNull();
    });
  });

  describe('findLatestInboundMessageId', () => {
    test('ignores an outbound message sent after the last inbound one', async () => {
      // A mensagem cronologicamente mais nova da conversa é a de saída (a
      // resposta automática) — se a função não filtrasse por direction, ela
      // devolveria o id dela, e todo job da fila da IA acharia que a "última
      // mensagem do cliente" foi escrita pela própria IA.
      const inbound = await createMessage({
        conversationId, direction: 'inbound', content: 'oi', whatsappMessageId: 'wamid.LATEST1', status: 'received',
      });
      await createMessage({
        conversationId, direction: 'outbound', content: 'resposta automática', whatsappMessageId: null, status: 'sent',
      });

      const latestInboundId = await findLatestInboundMessageId(conversationId);

      expect(latestInboundId).toBe(inbound.id);
    });

    test('returns the newest inbound message when there is more than one', async () => {
      await createMessage({
        conversationId, direction: 'inbound', content: 'oi', whatsappMessageId: 'wamid.OLD1', status: 'received',
      });
      const newest = await createMessage({
        conversationId, direction: 'inbound', content: 'minha internet caiu', whatsappMessageId: 'wamid.NEW1', status: 'received',
      });

      const latestInboundId = await findLatestInboundMessageId(conversationId);

      expect(latestInboundId).toBe(newest.id);
    });

    // Fase 1C: a autorresposta provável do destinatário não gera job de IA. Se ela contasse como
    // "a mais nova", o job de uma mensagem HUMANA ainda na fila desistiria sem responder.
    test('ignora a autorresposta provável marcada (e segue achando a mensagem humana)', async () => {
      const humana = await createMessage({ conversationId, direction: 'inbound', content: 'oi', status: 'received', sentAt: new Date('2026-09-25T15:00:00Z') });
      await createMessage({
        conversationId, direction: 'inbound', content: 'Estamos fechados.', status: 'received',
        metadata: { autorrespostaProvavel: true, autorrespostaMotivo: 'janela_padrao_forte' }, sentAt: new Date('2026-09-25T15:00:03Z'),
      });

      expect(await findLatestInboundMessageId(conversationId)).toBe(humana.id);
      expect(await findLatestInboundMessageId(conversationId, { tiposTriagem: true })).toBe(humana.id);
    });

    test('ignores an inbound photo that arrived after the text, so the text\'s job still proceeds', async () => {
      // The customer writes "minha internet caiu" and two seconds later sends a
      // photo of the router: the photo correctly schedules no AI job, but if it
      // became "the latest inbound message" here, the text's own job would see a
      // mismatch against this id and bail — nobody would answer.
      const texto = await createMessage({
        conversationId, direction: 'inbound', content: 'minha internet caiu', whatsappMessageId: 'wamid.TEXT1', status: 'received',
      });
      await createMessage({
        conversationId, direction: 'inbound', whatsappMessageId: 'wamid.PHOTO1', status: 'received',
        messageType: 'image', mediaPath: 'foto.jpg', mediaMimeType: 'image/jpeg',
      });

      const latestInboundId = await findLatestInboundMessageId(conversationId);

      expect(latestInboundId).toBe(texto.id);
    });

    test('returns null when the conversation has no inbound messages', async () => {
      await createMessage({
        conversationId, direction: 'outbound', content: 'oi', whatsappMessageId: null, status: 'sent',
      });

      const latestInboundId = await findLatestInboundMessageId(conversationId);

      expect(latestInboundId).toBeNull();
    });

    test('áudio transcrito conta como mensagem mais recente utilizável', async () => {
      await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w1',
        status: 'received', messageType: 'text' });
      const audio = await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w2',
        status: 'received', messageType: 'audio', mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg' });
      await saveTranscription(audio.id, { transcription: 'falei isso', model: 'm', ms: 5 });

      expect(await findLatestInboundMessageId(conversationId)).toBe(audio.id);
    });

    test('com incluirAudioTranscrito: false, áudio transcrito não conta — o job do texto continua valendo', async () => {
      // Cenário do finding 1: com transcriptionFeedAi desligado, um áudio
      // transcrito nunca vai gerar turno de IA (o worker de transcrição não
      // enfileira job pra ele). Se ele ainda contasse como "última mensagem
      // utilizável" aqui, o job do texto anterior se acharia ultrapassado e
      // ninguém responderia ao cliente — silenciosamente.
      const texto = await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w1b',
        status: 'received', messageType: 'text' });
      const audio = await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w2b',
        status: 'received', messageType: 'audio', mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg' });
      await saveTranscription(audio.id, { transcription: 'falei isso', model: 'm', ms: 5 });

      expect(await findLatestInboundMessageId(conversationId, { incluirAudioTranscrito: false })).toBe(texto.id);
    });

    test('áudio SEM transcrição não conta', async () => {
      const texto = await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w3',
        status: 'received', messageType: 'text' });
      await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w4',
        status: 'received', messageType: 'audio', mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg' });

      expect(await findLatestInboundMessageId(conversationId)).toBe(texto.id);
    });

    test('foto continua não contando', async () => {
      const texto = await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w5',
        status: 'received', messageType: 'text' });
      await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w6',
        status: 'received', messageType: 'image', mediaPath: 'a.jpg', mediaMimeType: 'image/jpeg' });

      expect(await findLatestInboundMessageId(conversationId)).toBe(texto.id);
    });

    test('com tiposTriagem: true, uma imagem enviada depois de um texto é a mais recente', async () => {
      // Na triagem a IA reage a imagem e documento (placeholder no histórico),
      // então o job da imagem não pode se achar ultrapassado.
      await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w7',
        status: 'received', messageType: 'text' });
      const foto = await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w8',
        status: 'received', messageType: 'image', mediaPath: 'a.jpg', mediaMimeType: 'image/jpeg' });

      expect(await findLatestInboundMessageId(conversationId, { tiposTriagem: true })).toBe(foto.id);
    });

    test('sem tiposTriagem, a mesma imagem continua não contando (a mais recente é o texto)', async () => {
      const texto = await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w9',
        status: 'received', messageType: 'text' });
      await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w10',
        status: 'received', messageType: 'image', mediaPath: 'a.jpg', mediaMimeType: 'image/jpeg' });

      expect(await findLatestInboundMessageId(conversationId)).toBe(texto.id);
    });

    test('I1 (fix round 1): com tiposTriagem: true, uma figurinha depois do texto NÃO conta — só text/image/document/audio', async () => {
      // scheduleAiTriage (ai.service.js) nunca enfileira job para sticker,
      // vídeo ou localização. Se tiposTriagem contasse QUALQUER tipo (como o
      // antigo qualquerTipo fazia), a figurinha viraria "a mais nova" sem
      // nenhum job existir para ela — o job do texto (que respondeu de
      // verdade) se acharia ultrapassado e sairia sem responder, emudecendo a
      // triagem até o job de timeout.
      const texto = await createMessage({ conversationId, direction: 'inbound', content: 'meu cpf é 111', whatsappMessageId: 'w11',
        status: 'received', messageType: 'text' });
      await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w12',
        status: 'received', messageType: 'sticker', mediaPath: 'a.webp', mediaMimeType: 'image/webp' });

      expect(await findLatestInboundMessageId(conversationId, { tiposTriagem: true })).toBe(texto.id);
    });
  });

  describe('findLatestInboundImage', () => {
    test('devolve a última imagem do CLIENTE, ignorando o texto posterior e a imagem de saída', async () => {
      const foto = await createMessage({
        conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wimg1',
        status: 'received', messageType: 'image', mediaPath: 'a.png', mediaMimeType: 'image/png',
      });
      await createMessage({
        conversationId, direction: 'inbound', content: 'mandei o comprovante', whatsappMessageId: 'wimg2',
        status: 'received', messageType: 'text',
      });
      await createMessage({
        conversationId, direction: 'outbound', content: null, whatsappMessageId: 'wimg3',
        status: 'sent', messageType: 'image', mediaPath: 'saida.png', mediaMimeType: 'image/png',
      });

      const imagem = await findLatestInboundImage(conversationId, { withinMs: 24 * 3600 * 1000 });

      expect(imagem).toMatchObject({ id: foto.id, mediaPath: 'a.png', mediaMimeType: 'image/png' });
      expect(imagem.createdAt).toBeInstanceOf(Date);
    });

    test('entre duas imagens do cliente, devolve a mais nova', async () => {
      await createMessage({
        conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wimg4',
        status: 'received', messageType: 'image', mediaPath: 'velha.jpg', mediaMimeType: 'image/jpeg',
      });
      const nova = await createMessage({
        conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wimg5',
        status: 'received', messageType: 'image', mediaPath: 'nova.jpg', mediaMimeType: 'image/jpeg',
      });

      const imagem = await findLatestInboundImage(conversationId, { withinMs: 24 * 3600 * 1000 });

      expect(imagem.id).toBe(nova.id);
      expect(imagem.mediaPath).toBe('nova.jpg');
    });

    test('imagem fora da janela não conta: a leitura de comprovante não pode pegar a foto de antiontem', async () => {
      const foto = await createMessage({
        conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wimg6',
        status: 'received', messageType: 'image', mediaPath: 'antiga.png', mediaMimeType: 'image/png',
      });
      await getPool().query("UPDATE messages SET created_at = now() - interval '2 days' WHERE id = $1", [foto.id]);

      expect(await findLatestInboundImage(conversationId, { withinMs: 24 * 3600 * 1000 })).toBeNull();
      expect((await findLatestInboundImage(conversationId, { withinMs: 72 * 3600 * 1000 })).id).toBe(foto.id);
    });

    test('conversa sem imagem do cliente devolve null', async () => {
      await createMessage({
        conversationId, direction: 'inbound', content: 'só texto', whatsappMessageId: 'wimg7',
        status: 'received', messageType: 'text',
      });

      expect(await findLatestInboundImage(conversationId, { withinMs: 24 * 3600 * 1000 })).toBeNull();
    });
  });

  test('uma mensagem de áudio carrega os campos de transcrição em branco por padrão', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-1',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    expect(message.transcription).toBeNull();
    expect(message.transcriptionStatus).toBeNull();
    expect(message.audioDurationSeconds).toBeNull();
  });

  test('markTranscriptionPending grava o status e a duração', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-2',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    const updated = await markTranscriptionPending(message.id, 42);
    expect(updated.transcriptionStatus).toBe('pending');
    expect(updated.audioDurationSeconds).toBe(42);
  });

  test('saveTranscription grava texto, modelo e tempo, e marca completed', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-3',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    const updated = await saveTranscription(message.id, {
      transcription: 'minha internet caiu', model: 'modelo-x', ms: 1234,
    });
    expect(updated.transcription).toBe('minha internet caiu');
    expect(updated.transcriptionStatus).toBe('completed');
    expect(updated.transcriptionModel).toBe('modelo-x');
    expect(updated.transcriptionMs).toBe(1234);
  });

  test('markTranscriptionFailed aceita failed e skipped com motivo', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-4',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    const falhou = await markTranscriptionFailed(message.id, { status: 'failed', detail: 'timeout', ms: 900 });
    expect(falhou.transcriptionStatus).toBe('failed');
    expect(falhou.transcriptionDetail).toBe('timeout');

    const pulado = await markTranscriptionFailed(message.id, { status: 'skipped', detail: 'áudio longo demais', ms: null });
    expect(pulado.transcriptionStatus).toBe('skipped');
  });

  test('as funções devolvem null para id inexistente', async () => {
    expect(await markTranscriptionProcessing('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('a transcrição chega por listMessagesByConversation, não só pelo RETURNING', async () => {
    // Este é o teste que pega a armadilha das colunas enumeradas: escreve por uma
    // função e relê por OUTRA. Se a coluna faltar na lista inline daquela consulta,
    // o texto vem undefined mesmo estando no banco.
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-5',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    await saveTranscription(message.id, { transcription: 'texto relido', model: 'm', ms: 10 });

    const lista = await listMessagesByConversation(conversationId);
    const relida = lista.find((m) => m.id === message.id);
    expect(relida.transcription).toBe('texto relido');
    expect(relida.transcriptionStatus).toBe('completed');

    const recentes = await listRecentMessagesByConversation(conversationId, 50);
    const naRecente = recentes.find((m) => m.id === message.id);
    expect(naRecente.transcription).toBe('texto relido');
  });
});

// A hora da mensagem recebida tem que ser a que o provedor informou, nao a hora
// em que nos gravamos: quando o webhook atrasa ou e reentregue, o now() do
// banco poe no historico uma hora que nunca existiu — e e por essa hora que o
// atendente calcula a janela de 24 h da Meta.
describe('createMessage com a hora informada pelo provedor', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, messages CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511966665556', 'Rosanira');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Hora',
      phoneNumber: '+5511999990011',
      config: { phoneNumberId: '333', accessToken: 'tok3' },
    });
    const conversation = await createConversation(contact.id, channel.id);
    conversationId = conversation.id;
  });

  test('grava a mensagem com a hora que veio no webhook', async () => {
    const enviadaEm = new Date('2026-09-16T23:31:00.000Z');

    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Ok',
      status: 'received',
      sentAt: enviadaEm,
    });

    expect(message.createdAt).toEqual(enviadaEm);
  });

  test('sem hora do provedor, usa a hora da gravacao', async () => {
    const antes = new Date();

    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Ok',
      status: 'received',
    });

    expect(message.createdAt.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
  });

  test('a ordem das mensagens segue a hora do provedor, nao a da gravacao', async () => {
    const primeira = await createMessage({
      conversationId, direction: 'inbound', content: 'primeira', status: 'received',
      sentAt: new Date('2026-09-16T21:32:00.000Z'),
    });
    const segunda = await createMessage({
      conversationId, direction: 'inbound', content: 'segunda', status: 'received',
      sentAt: new Date('2026-09-16T23:31:00.000Z'),
    });

    expect(primeira.createdAt.getTime()).toBeLessThan(segunda.createdAt.getTime());
  });
});

// O video e comprimido DEPOIS de gravado, fora do webhook: o worker troca o
// arquivo da mensagem quando termina.
describe('updateMessageMedia', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, messages CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511966665557', 'Video');
    const channel = await createChannel({ type: 'baileys', name: 'Canal Video', phoneNumber: '+5511999990012', config: {} });
    const conversation = await createConversation(contact.id, channel.id);
    conversationId = conversation.id;
  });

  test('troca o arquivo e o tipo da midia', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', status: 'received',
      messageType: 'video', mediaPath: 'original.mp4', mediaMimeType: 'video/quicktime',
    });

    const atualizada = await updateMessageMedia(message.id, { mediaPath: 'menor.mp4', mediaMimeType: 'video/mp4' });

    expect(atualizada.mediaPath).toBe('menor.mp4');
    expect(atualizada.mediaMimeType).toBe('video/mp4');
    expect((await findMessageById(message.id)).mediaPath).toBe('menor.mp4');
  });

  test('nao mexe no resto da mensagem', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', status: 'received', content: 'olha o problema',
      messageType: 'video', mediaPath: 'original.mp4', mediaMimeType: 'video/mp4',
    });

    const atualizada = await updateMessageMedia(message.id, { mediaPath: 'menor.mp4', mediaMimeType: 'video/mp4' });

    expect(atualizada.content).toBe('olha o problema');
    expect(atualizada.messageType).toBe('video');
    expect(atualizada.direction).toBe('inbound');
  });

  test('devolve null para uma mensagem que nao existe', async () => {
    expect(await updateMessageMedia('00000000-0000-0000-0000-000000000000', { mediaPath: 'x.mp4', mediaMimeType: 'video/mp4' })).toBeNull();
  });
});

// O disco so cresce: nada nunca era apagado. Arquivo com mais de 12 meses sai,
// mas a MENSAGEM fica — a bolha, a legenda e o tipo permanecem no historico do
// atendimento; some so o arquivo.
describe('retencao de midia', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, messages CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511966665558', 'Retencao');
    const channel = await createChannel({ type: 'baileys', name: 'Canal Retencao', phoneNumber: '+5511999990013', config: {} });
    const conversation = await createConversation(contact.id, channel.id);
    conversationId = conversation.id;
  });

  async function criarMidia({ mesesAtras, mediaPath = 'antigo.jpg' }) {
    return createMessage({
      conversationId, direction: 'inbound', status: 'received', messageType: 'image',
      mediaPath, mediaMimeType: 'image/jpeg', content: 'olha o comprovante',
      sentAt: new Date(Date.now() - mesesAtras * 30 * 24 * 60 * 60 * 1000),
    });
  }

  test('lista so os arquivos mais antigos que o limite', async () => {
    const antiga = await criarMidia({ mesesAtras: 13, mediaPath: 'velho.jpg' });
    await criarMidia({ mesesAtras: 6, mediaPath: 'novo.jpg' });

    const expirados = await listExpiredMedia({ olderThanDays: 360 });

    expect(expirados.map((m) => m.id)).toEqual([antiga.id]);
    expect(expirados[0].mediaPath).toBe('velho.jpg');
  });

  test('nao lista mensagem que ja teve o arquivo removido', async () => {
    const antiga = await criarMidia({ mesesAtras: 13 });
    await clearMessageMedia(antiga.id);

    expect(await listExpiredMedia({ olderThanDays: 360 })).toEqual([]);
  });

  test('remover o arquivo mantem a mensagem e a legenda', async () => {
    const antiga = await criarMidia({ mesesAtras: 13 });

    await clearMessageMedia(antiga.id);

    const depois = await findMessageById(antiga.id);
    expect(depois).not.toBeNull();
    expect(depois.mediaPath).toBeNull();
    expect(depois.content).toBe('olha o comprovante');
    expect(depois.messageType).toBe('image');
  });

  test('respeita o limite pedido', async () => {
    await criarMidia({ mesesAtras: 7 });

    expect(await listExpiredMedia({ olderThanDays: 360 })).toEqual([]);
    expect((await listExpiredMedia({ olderThanDays: 180 })).length).toBe(1);
  });

  test('mensagem de texto nunca entra na lista', async () => {
    await createMessage({
      conversationId, direction: 'inbound', status: 'received', content: 'so texto',
      sentAt: new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000),
    });

    expect(await listExpiredMedia({ olderThanDays: 360 })).toEqual([]);
  });
});
