jest.mock('./ai-queue');
jest.mock('../ai/ai-orchestrator');
jest.mock('../ai/ai-suggestion.repository');
jest.mock('../ai/ai-config.repository');
jest.mock('../ai/triage-close-reason');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/message.repository');
jest.mock('../realtime/socket-server');
jest.mock('../ai/identity-resolver');
jest.mock('../channels/channel.repository');
jest.mock('../ai/night-mode');
jest.mock('../queue/outbound-queue');

const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const { motivoDeEncerramentoAtivo } = require('../ai/triage-close-reason');
const {
  getConversationWithContact, concludeAiTriage, incrementTriageAttempts, isPhoneContested,
  closeConversationByAi,
} = require('../conversations/conversation.repository');
const { findContactById } = require('../conversations/contact.repository');
const { findLatestInboundMessageId, findMessageById } = require('../conversations/message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { resolverIdentidade } = require('../ai/identity-resolver');
const { findChannelById } = require('../channels/channel.repository');
const { isNightModeActive } = require('../ai/night-mode');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { handleAiJob } = require('./ai-worker');

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue({ mode: 'assistant' });
  getConversationWithContact.mockResolvedValue({
    id: 'c-1', channelId: 'ch-1', status: 'assigned', assignedAgentId: 'a-1', contactId: 'ct-1',
  });
  findContactById.mockResolvedValue({ id: 'ct-1' });
  // Por padrão, o job carrega a mensagem mais nova: os testes que não são
  // sobre o próprio design "a mensagem mais nova ganha" passam por ele sem
  // precisar pensar nele.
  findLatestInboundMessageId.mockResolvedValue('m-1');
  createSuggestion.mockResolvedValue({ id: 's-1', content: 'texto' });
});

describe('ai-worker', () => {
  test('assistant mode stores a suggestion and notifies the assigned agent', async () => {
    runAiTurn.mockResolvedValue({ texto: 'Seu plano é 600MB.', toolsExecutadas: [], erro: null });

    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(createSuggestion).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: null, content: 'Seu plano é 600MB.', acoesExecutadas: [] });
    expect(emitToAgent).toHaveBeenCalledWith('a-1', 'ai:suggestion', expect.objectContaining({ conversationId: 'c-1' }));
  });

  test('envia ao atendente as ações que a IA executou no turno', async () => {
    // Uma ação sensível age no serviço do cliente antes de o atendente ver o
    // texto — ele precisa saber que aconteceu, não só o que a IA sugere dizer.
    runAiTurn.mockResolvedValue({
      texto: 'Sua internet foi liberada por 3 dias.',
      toolsExecutadas: [{ nome: 'consultar_faturas' }, { nome: 'desbloqueio_confianca' }],
      erro: null,
    });

    createSuggestion.mockResolvedValue({ id: 's-9', content: 'Sua internet foi liberada por 3 dias.', acoesExecutadas: ['consultar_faturas', 'desbloqueio_confianca'] });

    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(createSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      acoesExecutadas: ['consultar_faturas', 'desbloqueio_confianca'],
    }));
    expect(emitToAgent).toHaveBeenCalledWith('a-1', 'ai:suggestion', expect.objectContaining({
      suggestion: expect.objectContaining({ acoesExecutadas: ['consultar_faturas', 'desbloqueio_confianca'] }),
    }));
  });

  test('converte o markdown do modelo para o formato do WhatsApp antes de gravar a sugestão', async () => {
    // O modelo escreve **negrito**; o WhatsApp só entende *negrito*. Sem a
    // conversão o cliente vê os asteriscos duplos literalmente.
    runAiTurn.mockResolvedValue({ texto: 'Preciso saber **qual contrato** consultar.', toolsExecutadas: [], erro: null });

    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(createSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Preciso saber *qual contrato* consultar.' })
    );
  });

  test('does nothing when the turn produced no text', async () => {
    runAiTurn.mockResolvedValue({ texto: null, toolsExecutadas: [], erro: 'openai down' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(createSuggestion).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('skips a conversation that was closed while the job waited', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'c-1', status: 'closed' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).not.toHaveBeenCalled();
  });

  test('assistant mode skips a conversation with no assigned agent', async () => {
    // Sem atendente não há para quem sugerir.
    getConversationWithContact.mockResolvedValue({ id: 'c-1', status: 'waiting', assignedAgentId: null, contactId: 'ct-1' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).not.toHaveBeenCalled();
  });

  test('skips when a newer inbound message has arrived since this job was queued', async () => {
    // O design "a mensagem mais nova ganha": este job carrega messageId
    // 'm-1', mas o cliente já mandou 'm-2' antes de este job rodar. Um job
    // mais novo (com o histórico completo) já foi ou será agendado para
    // 'm-2' — este aqui tem que sair sem gastar uma chamada à OpenAI. Uma
    // implementação que pule essa checagem faz este teste falhar, porque
    // runAiTurn teria sido chamado.
    findLatestInboundMessageId.mockResolvedValue('m-2');
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).not.toHaveBeenCalled();
  });

  test('proceeds when its messageId is still the latest inbound message', async () => {
    findLatestInboundMessageId.mockResolvedValue('m-1');
    runAiTurn.mockResolvedValue({ texto: 'Seu plano é 600MB.', toolsExecutadas: [], erro: null });

    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(runAiTurn).toHaveBeenCalled();
  });

  describe('transcriptionFeedAi e a mensagem mais recente', () => {
    // Finding 1 (fix round 1): com transcriptionFeedAi desligado, um áudio
    // transcrito nunca gera job de IA (o worker de transcrição não enfileira
    // um pra ele). Se findLatestInboundMessageId ainda contasse esse áudio
    // como "a mais nova", o job do texto anterior se acharia ultrapassado e
    // sairia sem responder — silenciosamente, sem log nenhum.
    test('com transcriptionFeedAi desligado, pede a mais recente SEM contar áudio transcrito', async () => {
      getAiConfig.mockResolvedValue({ mode: 'assistant', transcriptionFeedAi: false });
      runAiTurn.mockResolvedValue({ texto: 'Seu plano é 600MB.', toolsExecutadas: [], erro: null });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(findLatestInboundMessageId).toHaveBeenCalledWith('c-1', { incluirAudioTranscrito: false });
      expect(runAiTurn).toHaveBeenCalled();
    });

    test('com transcriptionFeedAi ligado (padrão), pede a mais recente contando áudio transcrito', async () => {
      getAiConfig.mockResolvedValue({ mode: 'assistant', transcriptionFeedAi: true });
      runAiTurn.mockResolvedValue({ texto: 'Seu plano é 600MB.', toolsExecutadas: [], erro: null });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(findLatestInboundMessageId).toHaveBeenCalledWith('c-1', { incluirAudioTranscrito: true });
    });
  });
});

describe('ai-worker — triagem', () => {
  const PENDING = { id: 'c-1', channelId: 'ch-1', status: 'waiting', assignedAgentId: null, triageState: 'pending', triageAttempts: 0, contactId: 'ct-1' };
  beforeEach(() => {
    // mockReset (não só o clearAllMocks do beforeEach de topo) para estes
    // dois: vários testes abaixo empilham mockResolvedValueOnce, e
    // clearAllMocks/mockClear NÃO esvazia a fila de "once" pendente — só
    // mockReset remove implementações (incluindo once-queue). Sem isto, um
    // valor "once" que sobrou de um teste anterior (por o código ter chamado
    // o mock menos vezes do que a fila tinha) vazaria para o teste seguinte,
    // antes do mockResolvedValue "default" abaixo.
    getConversationWithContact.mockReset().mockResolvedValue(PENDING);
    runAiTurn.mockReset().mockResolvedValue({ texto: 'Para localizar seu cadastro, me informe seu CPF.', toolsExecutadas: [], erro: null, triagemConcluida: null });
    getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: 'k', model: 'm', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3, transcriptionFeedAi: true });
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true });
    findContactById.mockResolvedValue({ id: 'ct-1', phoneNumber: '55989', sgpDocument: null });
    resolverIdentidade.mockResolvedValue({ nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] });
    findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text' });
    findLatestInboundMessageId.mockResolvedValue('m-1');
    isPhoneContested.mockResolvedValue(false);
    // Default: concludeAiTriage "ganha a corrida" (devolve a conversa
    // atualizada) — sem isto, concluirEmCodigo's guard (if (!conversa) return)
    // descartaria o broadcast em qualquer teste que não mocke isto por conta
    // própria, mesmo sem corrida nenhuma acontecendo no cenário.
    concludeAiTriage.mockResolvedValue({ id: 'c-1', triageState: 'completed' });
    closeConversationByAi.mockReset().mockResolvedValue({ id: 'c-1', status: 'closed' });
    motivoDeEncerramentoAtivo.mockReset().mockResolvedValue(null);
    // mockReset aqui também: clearAllMocks não apaga implementação, então um
    // mockReturnValue(true) de um teste do modo noturno vazaria para todos os
    // testes seguintes da triagem.
    isNightModeActive.mockReset().mockReturnValue(false);
  });

  test('conversa pending sem atendente roda o perfil de triagem e responde ao cliente como IA', async () => {
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ perfil: 'triagem', triagem: expect.objectContaining({ threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false }) }));
    // Primeiro turno: a saudação da hora entra por código na frente do texto.
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c-1', channelId: 'ch-1', sentBy: 'ai',
      content: expect.stringMatching(/^(Bom dia|Boa tarde|Boa noite)! Para localizar seu cadastro, me informe seu CPF\.$/),
    }));
    expect(incrementTriageAttempts).toHaveBeenCalledWith('c-1');
    expect(createSuggestion).not.toHaveBeenCalled();
  });

  test('primeira resposta ganha saudação com o primeiro nome quando o cliente foi reconhecido', async () => {
    // Teste real 2026-09-13: o modelo entregou o PIX por ferramenta e
    // respondeu sem cumprimentar. A saudação é garantida em código.
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Willemberg', contracts: [] });
    runAiTurn.mockResolvedValue({ texto: 'Enviei o PIX da sua fatura. Precisa de mais alguma coisa?', toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/^(Bom dia|Boa tarde|Boa noite), Willemberg! Enviei o PIX da sua fatura\./),
    }));
  });

  test('com o SGP fora, a saudação ainda sai com o nome guardado na memória', async () => {
    // O identity-resolver devolve a memória (sgpIndisponivel) em vez de
    // 'none': o worker não muda, mas é este caminho que impede o cliente
    // vinculado de ouvir "me informe seu CPF" quando o SGP cai.
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'memory', primeiroNome: 'Willemberg', contracts: [], sgpIndisponivel: true });
    runAiTurn.mockResolvedValue({ texto: 'Nosso sistema de consulta está instável agora. Já encaminhei ao Suporte.', toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/^(Bom dia|Boa tarde|Boa noite), Willemberg! Nosso sistema de consulta está instável agora\./),
    }));
  });

  test('saudação do período errado é corrigida em qualquer turno ("Bom dia" às 14h)', async () => {
    const { saudacaoDaHora } = jest.requireActual('../ai/saudacao');
    const certa = saudacaoDaHora();
    const errada = certa === 'Bom dia' ? 'Boa noite' : 'Bom dia';
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Willemberg', contracts: [] });
    getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 1 });
    runAiTurn.mockResolvedValue({ texto: `${errada}, Willemberg! Verifiquei aqui que sua conexão está offline.`, toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: `${certa}, Willemberg! Verifiquei aqui que sua conexão está offline.` }));
  });

  test('a saudação não é duplicada nem aplicada fora do primeiro turno', async () => {
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Willemberg', contracts: [] });
    // A saudação do período certo para a hora em que o teste roda: o worker
    // agora corrige "Bom dia" às 14h, então o texto precisa já vir certo.
    const { saudacaoDaHora } = jest.requireActual('../ai/saudacao');
    const jaCumprimenta = `${saudacaoDaHora()}, Willemberg! Me diz o endereço.`;
    runAiTurn.mockResolvedValue({ texto: jaCumprimenta, toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: jaCumprimenta }));

    enqueueOutboundMessage.mockClear();
    getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 1 });
    runAiTurn.mockResolvedValue({ texto: 'Perfeito. Enviei o PIX.', toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Perfeito. Enviei o PIX.' }));
  });

  test('turno que concluiu a triagem envia a frase final e não conta pergunta', async () => {
    runAiTurn.mockResolvedValue({ texto: 'Perfeito, João — o Financeiro continua daqui.', toolsExecutadas: [], erro: null, triagemConcluida: { setor: 'Financeiro' } });
    getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, triageState: 'completed' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalled();
    expect(incrementTriageAttempts).not.toHaveBeenCalled();
  });

  test('atendente assumiu durante o turno: descarta sem enviar', async () => {
    getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, status: 'assigned', assignedAgentId: 'a-1' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('no limite de perguntas força a conclusão; se ainda assim não concluir, conclui em código sem setor', async () => {
    getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 2 });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ triagem: expect.objectContaining({ forcarConclusao: true }) }));
    expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ sectorId: null, lowConfidence: true }));
    expect(broadcast).toHaveBeenCalledWith('queue:new', expect.any(Object));
  });

  test('canal com triagem desligada no meio: não chama o modelo, não conclui e não envia nada (I3, fix round 1)', async () => {
    // Ruling: um canal migrado do menu numérico para a IA (ai_enabled ligado,
    // ai_triage_enabled ainda desligado) pode ter conversas 'pending' abertas
    // de antes da migração. Concluir em código aqui mataria o menu numérico
    // com um resumo de "IA desligada" — o job de timeout já é o dono do caso
    // "triagem por IA interrompida"; este job apenas sai sem fazer nada.
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: false });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).not.toHaveBeenCalled();
    expect(concludeAiTriage).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('conversa assigned continua no perfil assistente, como hoje', async () => {
    getConversationWithContact.mockResolvedValue({ ...PENDING, status: 'assigned', assignedAgentId: 'a-1', triageState: 'completed' });
    runAiTurn.mockResolvedValue({ texto: 'sugestão', toolsExecutadas: [], erro: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).toHaveBeenCalledWith(expect.not.objectContaining({ perfil: 'triagem' }));
    expect(createSuggestion).toHaveBeenCalled();
  });

  test('job triage-timeout conclui só se ainda estiver pending', async () => {
    await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
    expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ sectorId: null, summary: expect.stringMatching(/IA indisponível/) }));
    jest.clearAllMocks();
    getConversationWithContact.mockResolvedValue({ ...PENDING, triageState: 'completed' });
    await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
    expect(concludeAiTriage).not.toHaveBeenCalled();
  });

  test('job triage-timeout não faz nada quando a conversa não está mais em waiting (ex.: silenciada ou fechada)', async () => {
    getConversationWithContact.mockResolvedValue({ ...PENDING, status: 'silent' });
    await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
    expect(concludeAiTriage).not.toHaveBeenCalled();
  });

  test('a mensagem mais nova ganha também na triagem', async () => {
    findLatestInboundMessageId.mockResolvedValue('m-2');
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).not.toHaveBeenCalled();
  });

  test('a checagem de "mensagem mais nova" na triagem conta os tipos que geram turno (text/image/document/audio)', async () => {
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(findLatestInboundMessageId).toHaveBeenCalledWith('c-1', { tiposTriagem: true });
  });

  test('o resolutor de identidade recebe ignorarTelefone: true quando o telefone já foi contestado nesta conversa', async () => {
    isPhoneContested.mockResolvedValue(true);
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(resolverIdentidade).toHaveBeenCalledWith(expect.objectContaining({ ignorarTelefone: true }));
  });

  test('o resolutor de identidade recebe ignorarTelefone: false quando o telefone não foi contestado', async () => {
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(resolverIdentidade).toHaveBeenCalledWith(expect.objectContaining({ ignorarTelefone: false }));
  });

  test('a identidade devolvida pelo turno (com data de nascimento e CPF) nunca é logada nem persistida pelo worker', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    runAiTurn.mockResolvedValue({
      texto: 'Perfeito.', toolsExecutadas: [], erro: null, triagemConcluida: null,
      identidade: { nivel: 'forte', origem: 'cpf_confirmed', dataNascimento: '1990-05-20', client: { document: '52998224725' } },
    });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    const tudoLogado = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join(' ');
    expect(tudoLogado).not.toContain('1990-05-20');
    expect(tudoLogado).not.toContain('52998224725');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // I4 (fix round 1): um admin pode fechar (ou silenciar) uma conversa em
  // fila sem assumi-la — a releitura antes de enviar precisa notar isso,
  // senão a IA manda mensagem pro cliente numa conversa já fechada.
  test('conversa fechada durante o turno (admin fechou sem assumir): descarta sem enviar', async () => {
    getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, status: 'closed' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('conversa silenciada durante o turno: descarta sem enviar', async () => {
    getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, status: 'silent' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  describe('encerramento pela própria IA', () => {

    // A releitura antes de enviar descarta conversa 'closed' — mas quando foi
    // o PRÓPRIO turno que fechou, a despedida ainda TEM de sair.
    test('turno que encerrou o atendimento ainda envia a despedida e não conta pergunta', async () => {
      runAiTurn.mockResolvedValue({ texto: 'Qualquer coisa é só chamar, João!', toolsExecutadas: [], erro: null, triagemConcluida: null, atendimentoEncerrado: true });
      // triageAttempts 1: o encerramento só existe depois de uma entrega em turno
      // anterior, então nunca é o primeiro turno (que ganharia a saudação em código).
      getConversationWithContact
        .mockResolvedValueOnce({ ...PENDING, triageAttempts: 1 })
        .mockResolvedValueOnce({ ...PENDING, triageAttempts: 1, status: 'closed', triageState: 'completed' });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Qualquer coisa é só chamar, João!' }));
      expect(incrementTriageAttempts).not.toHaveBeenCalled();
      expect(concludeAiTriage).not.toHaveBeenCalled();
    });

    test('timeout com entrega feita e motivo configurado encerra em vez de mandar para a fila', async () => {
      motivoDeEncerramentoAtivo.mockResolvedValue('rr-1');
      getConversationWithContact.mockResolvedValue({ ...PENDING, aiTriageResolvedByAi: true });

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(closeConversationByAi).toHaveBeenCalledWith('c-1', {
        reasonId: 'rr-1',
        summary: 'Resolvido pela IA (boleto/PIX entregue); cliente não respondeu e o atendimento foi encerrado sem atendente.',
      });
      expect(concludeAiTriage).not.toHaveBeenCalled();
      expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', expect.objectContaining({ closedAt: expect.any(String) }));
      expect(broadcast).not.toHaveBeenCalledWith('queue:new', expect.any(Object));
    });

    test('timeout sem nada entregue conclui para a fila como hoje', async () => {
      motivoDeEncerramentoAtivo.mockResolvedValue('rr-1');

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(closeConversationByAi).not.toHaveBeenCalled();
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ summary: expect.stringMatching(/IA indisponível/) }));
    });

    test('timeout com entrega feita mas sem motivo configurado conclui para a fila como hoje', async () => {
      getConversationWithContact.mockResolvedValue({ ...PENDING, aiTriageResolvedByAi: true });

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(closeConversationByAi).not.toHaveBeenCalled();
      expect(concludeAiTriage).toHaveBeenCalled();
    });

    // motivoDeEncerramentoAtivo devolve null também quando o motivo existe
    // mas foi DESATIVADO: para o worker os dois casos são o mesmo, e o
    // atendimento volta para a fila em vez de ser fechado com um motivo morto.
    test('timeout com o motivo desativado conclui para a fila, sem fechar', async () => {
      motivoDeEncerramentoAtivo.mockResolvedValue(null);
      getConversationWithContact.mockResolvedValue({ ...PENDING, aiTriageResolvedByAi: true });

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(closeConversationByAi).not.toHaveBeenCalled();
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ summary: expect.stringMatching(/IA indisponível/) }));
    });

    test('timeout que perde a corrida do fechamento não avisa ninguém', async () => {
      motivoDeEncerramentoAtivo.mockResolvedValue('rr-1');
      getConversationWithContact.mockResolvedValue({ ...PENDING, aiTriageResolvedByAi: true });
      closeConversationByAi.mockResolvedValue(null);

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(broadcastToDashboard).not.toHaveBeenCalled();
      expect(concludeAiTriage).not.toHaveBeenCalled();
    });
  });

  describe('modo noturno', () => {
    test('com o modo noturno ativo, passa noturno.ativo, retornoAs e limite +2 ao turno', async () => {
      isNightModeActive.mockReturnValue(true);
      getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: 'k', model: 'm', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3, transcriptionFeedAi: true, nightStartTime: '20:00', nightEndTime: '08:00' });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
        triagem: expect.objectContaining({ maxQuestions: 4, noturno: { ativo: true, retornoAs: '08:00' } }),
      }));
    });

    test('sem modo noturno, noturno.ativo é false e o limite é o configurado', async () => {
      isNightModeActive.mockReturnValue(false);
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
        triagem: expect.objectContaining({ maxQuestions: 2, noturno: { ativo: false, retornoAs: null } }),
      }));
    });
  });

  describe('corridas (I5, fix round 1)', () => {
    test('o timeout venceu a corrida: releitura mostra triageState completed com triagemConcluida null — descarta e não conta tentativa', async () => {
      // Diferente do teste "turno que concluiu a triagem": aqui é o job de
      // TIMEOUT (não o próprio turno) quem concluiu a conversa enquanto o
      // turno rodava — turno.triagemConcluida continua null.
      getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, triageState: 'completed' });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
      expect(incrementTriageAttempts).not.toHaveBeenCalled();
    });

    test('concluirEmCodigo não faz broadcast nenhum quando concludeAiTriage perde a corrida (devolve null)', async () => {
      getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 2 });
      concludeAiTriage.mockResolvedValue(null);
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(broadcast).not.toHaveBeenCalledWith('queue:new', expect.any(Object));
      expect(broadcastToDashboard).not.toHaveBeenCalledWith('dashboard:conversation', expect.any(Object));
    });
  });
});
