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
