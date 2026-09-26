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
jest.mock('../city-notices/city-notice.service');
jest.mock('../city-notices/city-notice.repository');
jest.mock('../cities/city.repository');
jest.mock('../sectors/reactivation-sector');

const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const { motivoDeEncerramentoAtivo } = require('../ai/triage-close-reason');
const {
  getConversationWithContact, concludeAiTriage, incrementTriageAttempts, isPhoneContested,
  closeConversationByAi, getThirdPartyScope, setThirdPartyScope, getTriageReactivation,
} = require('../conversations/conversation.repository');
const { setorDeReativacao } = require('../sectors/reactivation-sector');
const { findContactById } = require('../conversations/contact.repository');
const { findLatestInboundMessageId, findMessageById, listRecentMessagesByConversation, findLastMessageCreatedAt } = require('../conversations/message.repository');
const { enqueueTriageTimeout } = require('./ai-queue');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { resolverIdentidade } = require('../ai/identity-resolver');
const { findChannelById } = require('../channels/channel.repository');
const { isNightModeActive } = require('../ai/night-mode');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { enviarAvisoDeCidadeSePreciso } = require('../city-notices/city-notice.service');
const { selecionarAvisoDoContato } = require('../city-notices/city-notice.service');
const { findCityById } = require('../cities/city.repository');
const { handleAiJob } = require('./ai-worker');

beforeEach(() => {
  jest.clearAllMocks();
  // O padrao do arquivo e o assistente COM sugestao ligada: a maioria dos
  // testes daqui exercita justamente esse caminho.
  getAiConfig.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: true });
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

    expect(createSuggestion).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: null, content: 'Seu plano é 600MB.', acoesExecutadas: [], acoesPropostas: [] });
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
    getAiConfig.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: true, apiKey: 'k', model: 'm', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3, transcriptionFeedAi: true });
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
    enviarAvisoDeCidadeSePreciso.mockReset().mockResolvedValue(null);
    selecionarAvisoDoContato.mockReset().mockResolvedValue(null);
    findCityById.mockReset().mockResolvedValue(null);
    // Default benigno para o bloco de carga do escopo de terceiro (logo depois
    // de resolverIdentidade em ai-worker.js): sem isto, só o describe('escopo
    // de terceiro') abaixo configurava getThirdPartyScope, e um
    // mockRejectedValue (não-Once, sem Once) de um dos quatro testes ali
    // vazava para TODOS os testes seguintes do describe inteiro — 17 chamadas
    // de "Failed to load the third party scope" de mentira poluindo o log de
    // testes sem nenhuma relação com terceiro. Mesma classe de problema do
    // Achado 2 em tool-registry.test.js. "Não há escopo" é o estado normal da
    // esmagadora maioria das conversas, então é o default certo aqui; os
    // quatro testes do describe abaixo continuam sobrescrevendo localmente.
    getThirdPartyScope.mockResolvedValue(null);
    // setThirdPartyScope nunca é feito rejeitar em lugar nenhum do arquivo
    // hoje, então não há vazamento em cima dela ainda — mas ela é chamada por
    // dentro do mesmo bloco (quando o escopo carregado está expirado) e era a
    // única função nova desta lista sem default explícito, dependendo do
    // automock puro. Mesmo raciocínio de defesa que getThirdPartyScope acima:
    // um default benigno aqui evita que um mockRejectedValue esquecido em
    // teste futuro vaze pelo mesmo motivo.
    setThirdPartyScope.mockResolvedValue();
    // Regra financeira 0/1/2+: a esmagadora maioria das conversas não está marcada para a reativação.
    getTriageReactivation.mockReset().mockResolvedValue(null);
    setorDeReativacao.mockReset().mockResolvedValue(null);
  });

  // Idempotência de enviar_boleto/gerar_pix: o turno precisa saber QUAL
  // mensagem do cliente o abriu. É esse id que separa "o cliente pediu o
  // reenvio agora" de "o modelo chamou a ferramenta duas vezes na mesma
  // mensagem". O worker já o tem em mãos, e já conferiu (logo acima) que é a
  // mensagem inbound mais recente.
  // Documento pendente (25/09/2026): o registro do pedido é a própria mensagem — a metadata diz de
  // quem é o documento pedido (o de quem fala, ou o de outra pessoa). Nada além disso no banco.
  describe('pedido de documento marcado na própria mensagem', () => {
    test('a resposta que pede o documento sai com a marca de quem é o documento', async () => {
      runAiTurn.mockResolvedValue({ texto: 'Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.', toolsExecutadas: [], erro: null, triagemConcluida: null, pedidoDeDocumento: { alvo: 'principal' } });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
        sentBy: 'ai', metadata: { pedidoDeDocumento: { alvo: 'principal' } },
      }));
    });

    test('resposta que não pede documento sai sem metadata nenhuma', async () => {
      runAiTurn.mockResolvedValue({ texto: 'Entendi, sem o cadastro não consigo ver a conexão.', toolsExecutadas: [], erro: null, triagemConcluida: null, pedidoDeDocumento: null });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage.mock.calls[0][0]).not.toHaveProperty('metadata');
    });
  });

  describe('messageId repassado ao turno', () => {
    test('runAiTurn recebe o messageId do job', async () => {
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm-1' }));
    });

    test('o id repassado é o da mensagem do job, não outro qualquer', async () => {
      findLatestInboundMessageId.mockReset().mockResolvedValue('m-77');
      findMessageById.mockResolvedValue({ id: 'm-77', messageType: 'text' });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-77' });
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm-77' }));
    });

    // O job que não é mais o mais novo sai antes do turno: não há messageId
    // para repassar porque não há turno nenhum.
    test('job ultrapassado não roda turno', async () => {
      findLatestInboundMessageId.mockReset().mockResolvedValue('m-2');
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(runAiTurn).not.toHaveBeenCalled();
    });
  });

  // Print 2026-09-16: "Ah" e "Pai!" em rajada → duas respostas idênticas
  // ("Bom dia! Como posso ajudar você hoje?"). A checagem "ainda é a última
  // mensagem?" só existia ANTES do turno; a mensagem que chega DURANTE o turno
  // gerava um segundo job e uma segunda resposta.
  describe('mensagem nova durante o turno e resposta repetida', () => {
    // mockReset: os testes abaixo empilham "once" que nem sempre são
    // consumidos (a reconferência é pulada quando o turno teve efeito), e
    // clearAllMocks não esvazia a fila de once — vazaria para o teste seguinte.
    beforeEach(() => {
      findLatestInboundMessageId.mockReset().mockResolvedValue('m-1');
      listRecentMessagesByConversation.mockReset().mockResolvedValue([]);
    });

    test('chegou mensagem nova durante o turno: descarta a resposta e não conta pergunta', async () => {
      findLatestInboundMessageId
        .mockResolvedValueOnce('m-1') // antes do turno: este job é o mais novo
        .mockResolvedValueOnce('m-2'); // depois do turno: chegou "Pai!"

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledTimes(1);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
      expect(incrementTriageAttempts).not.toHaveBeenCalled();
    });

    test('mensagem nova durante o turno, mas o turno concluiu a triagem: a resposta sai', async () => {
      findLatestInboundMessageId.mockResolvedValueOnce('m-1').mockResolvedValueOnce('m-2');
      runAiTurn.mockResolvedValue({ texto: 'Vou encaminhar você para o Comercial.', toolsExecutadas: [{ nome: 'concluir_triagem' }], erro: null, triagemConcluida: { setor: 'Comercial' } });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Vou encaminhar') }));
    });

    test('mensagem nova durante o turno, mas o turno enviou o boleto: a resposta sai', async () => {
      findLatestInboundMessageId.mockResolvedValueOnce('m-1').mockResolvedValueOnce('m-2');
      runAiTurn.mockResolvedValue({ texto: 'Enviei acima o boleto em PDF.', toolsExecutadas: [{ nome: 'enviar_boleto' }], erro: null, triagemConcluida: null });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Enviei acima o boleto') }));
    });

    test('resposta igual à última mensagem da IA nesta conversa: não envia de novo', async () => {
      getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 1 });
      findLatestInboundMessageId.mockResolvedValue('m-2');
      // listRecentMessagesByConversation devolve em ordem CRONOLÓGICA (a mais
      // antiga primeiro) — ver o .reverse() no repositório.
      listRecentMessagesByConversation.mockResolvedValue([
        { id: 'o-1', direction: 'outbound', sentBy: 'ai', content: 'Bom dia! Como posso ajudar você hoje?' },
        { id: 'm-2', direction: 'inbound', content: 'Pai!' },
      ]);
      runAiTurn.mockResolvedValue({ texto: 'Bom dia! Como posso ajudar você hoje?', toolsExecutadas: [], erro: null, triagemConcluida: null });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-2' });
        expect(enqueueOutboundMessage).not.toHaveBeenCalled();
        expect(incrementTriageAttempts).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    // Print 2026-09-17: a IA mandou a MESMA pergunta de diagnóstico três vezes
    // seguidas. A guarda existia mas olhava a PRIMEIRA resposta da IA da
    // conversa (a saudação), não a última — listRecentMessagesByConversation
    // devolve em ordem cronológica.
    test('repetição é detectada mesmo com várias mensagens da IA antes no histórico', async () => {
      const MODELO = 'Verifiquei aqui que seu contrato está ativo e sua conexão aparece online no momento. Me conta: está totalmente sem acesso, com lentidão ou a conexão fica caindo?';
      getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 2 });
      findLatestInboundMessageId.mockResolvedValue('m-4');
      listRecentMessagesByConversation.mockResolvedValue([
        { id: 'm-1', direction: 'inbound', content: 'Boa tarde' },
        { id: 'o-1', direction: 'outbound', sentBy: 'ai', content: 'Boa tarde! Como posso ajudar você hoje?' },
        { id: 'm-2', direction: 'inbound', content: 'Sobre o sinal da internet tá muito ruim faz dias' },
        { id: 'o-2', direction: 'outbound', sentBy: 'ai', content: 'Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.' },
        { id: 'm-3', direction: 'inbound', content: '62373943387' },
        { id: 'o-3', direction: 'outbound', sentBy: 'ai', content: MODELO },
        { id: 'm-4', direction: 'inbound', content: 'Lentidão' },
      ]);
      runAiTurn.mockResolvedValue({ texto: MODELO, toolsExecutadas: [{ nome: 'consultar_status_todos_contratos' }], erro: null, triagemConcluida: null });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-4' });
        expect(enqueueOutboundMessage).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    test('repetição de uma resposta anterior (não só a última) também é barrada', async () => {
      const PERGUNTA = 'Me conta: está totalmente sem acesso, com lentidão ou a conexão fica caindo?';
      getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 2 });
      findLatestInboundMessageId.mockResolvedValue('m-3');
      listRecentMessagesByConversation.mockResolvedValue([
        { id: 'o-1', direction: 'outbound', sentBy: 'ai', content: PERGUNTA },
        { id: 'm-2', direction: 'inbound', content: 'Lentidão' },
        { id: 'o-2', direction: 'outbound', sentBy: 'ai', content: 'Entendi. Acontece em todos os aparelhos?' },
        { id: 'm-3', direction: 'inbound', content: 'Está muito lento' },
      ]);
      runAiTurn.mockResolvedValue({ texto: PERGUNTA, toolsExecutadas: [], erro: null, triagemConcluida: null });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-3' });
        expect(enqueueOutboundMessage).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    test('resposta nova, diferente das anteriores, é enviada normalmente', async () => {
      getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 2 });
      findLatestInboundMessageId.mockResolvedValue('m-3');
      listRecentMessagesByConversation.mockResolvedValue([
        { id: 'o-1', direction: 'outbound', sentBy: 'ai', content: 'Me conta: está sem acesso, com lentidão ou caindo?' },
        { id: 'm-3', direction: 'inbound', content: 'Lentidão' },
      ]);
      runAiTurn.mockResolvedValue({ texto: 'Entendi. Você consegue fazer um teste de velocidade perto do equipamento?', toolsExecutadas: [], erro: null, triagemConcluida: null });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-3' });

      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('teste de velocidade') }));
    });

    test('da segunda resposta em diante, a saudação de período do começo é removida', async () => {
      getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 1 });
      findLatestInboundMessageId.mockResolvedValue('m-2');
      listRecentMessagesByConversation.mockResolvedValue([]);
      runAiTurn.mockResolvedValue({ texto: 'Bom dia! Verifiquei seu contrato e está ativo.', toolsExecutadas: [], erro: null, triagemConcluida: null });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-2' });

      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Verifiquei seu contrato e está ativo.' }));
    });
  });

  describe('aviso de cidade', () => {
    const AVISO = { id: 'notice-1', cityId: 'city-1', message: 'Falha na fibra em Cândido Mendes.' };
    const CONTATO_COM_CIDADE = { id: 'ct-1', phoneNumber: '55989', sgpDocument: null, cityId: 'city-1' };

    test('tenta o aviso DEPOIS de identificar — a cidade pode ter acabado de ser preenchida pelo SGP', async () => {
      // A mensagem de entrada roda antes da identificação: naquele momento o
      // contato ainda estava sem cidade e o aviso não tinha como sair.
      findContactById.mockResolvedValue(CONTATO_COM_CIDADE);

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(enviarAvisoDeCidadeSePreciso).toHaveBeenCalledWith({
        contact: CONTATO_COM_CIDADE, conversationId: 'c-1', channelId: 'ch-1',
      });
      expect(enviarAvisoDeCidadeSePreciso.mock.invocationCallOrder[0])
        .toBeGreaterThan(resolverIdentidade.mock.invocationCallOrder[0]);
    });

    test('o aviso ativo vai para o turno mesmo quando a mensagem já tinha sido entregue antes', async () => {
      findContactById.mockResolvedValue(CONTATO_COM_CIDADE);
      enviarAvisoDeCidadeSePreciso.mockResolvedValue(null); // já recebeu
      selecionarAvisoDoContato.mockResolvedValue({ aviso: AVISO, lugarId: 'city-1' });
      findCityById.mockResolvedValue({ id: 'city-1', name: 'Cândido Mendes' });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
        avisoCidade: { cidade: 'Cândido Mendes', mensagem: 'Falha na fibra em Cândido Mendes.' },
      }));
    });

    // Um aviso por turno (25/09/2026): a marca transitória diz se o aviso saiu para o cliente
    // NESTE turno — mandado agora pelo worker, ou pela entrada desta mesma mensagem.
    describe('aviso enviado neste turno', () => {
      const { findNoticeDeliverySentAt } = require('../city-notices/city-notice.repository');
      beforeEach(() => {
        findContactById.mockResolvedValue(CONTATO_COM_CIDADE);
        selecionarAvisoDoContato.mockResolvedValue({ aviso: AVISO, lugarId: 'city-1' });
        findCityById.mockResolvedValue({ id: 'city-1', name: 'Cândido Mendes' });
        findNoticeDeliverySentAt.mockReset();
      });

      test('o worker acabou de mandar o aviso: o turno recebe o fato COM a marca', async () => {
        enviarAvisoDeCidadeSePreciso.mockResolvedValue(AVISO);
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
          avisoCidade: { cidade: 'Cândido Mendes', mensagem: 'Falha na fibra em Cândido Mendes.', enviadoNesteTurno: true },
        }));
      });

      test('a entrada DESTA mensagem mandou o aviso (entregue depois dela): também conta como deste turno', async () => {
        enviarAvisoDeCidadeSePreciso.mockResolvedValue(null);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', createdAt: new Date('2026-09-25T15:00:00.000Z') });
        findNoticeDeliverySentAt.mockResolvedValue(new Date('2026-09-25T15:00:01.000Z'));
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(findNoticeDeliverySentAt).toHaveBeenCalledWith('notice-1', 'ct-1');
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ avisoCidade: expect.objectContaining({ enviadoNesteTurno: true }) }));
      });

      test('aviso entregue em outro momento (bem antes desta mensagem): sem a marca — a resposta pode informar', async () => {
        enviarAvisoDeCidadeSePreciso.mockResolvedValue(null);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', createdAt: new Date('2026-09-25T15:00:00.000Z') });
        findNoticeDeliverySentAt.mockResolvedValue(new Date('2026-09-25T09:00:00.000Z'));
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
          avisoCidade: { cidade: 'Cândido Mendes', mensagem: 'Falha na fibra em Cândido Mendes.' },
        }));
      });

      test('falha ao ler a entrega: sem a marca (a resposta segura completa continua valendo)', async () => {
        const erro = jest.spyOn(console, 'error').mockImplementation(() => {});
        enviarAvisoDeCidadeSePreciso.mockResolvedValue(null);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', createdAt: new Date('2026-09-25T15:00:00.000Z') });
        findNoticeDeliverySentAt.mockRejectedValue(new Error('banco fora'));
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
          avisoCidade: { cidade: 'Cândido Mendes', mensagem: 'Falha na fibra em Cândido Mendes.' },
        }));
        erro.mockRestore();
      });
    });

    test('contato sem cidade: nada de aviso no turno', async () => {
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(findCityById).not.toHaveBeenCalled();
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ avisoCidade: null }));
    });

    test('cidade sem aviso ativo: nada de aviso no turno', async () => {
      findContactById.mockResolvedValue(CONTATO_COM_CIDADE);

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(selecionarAvisoDoContato).toHaveBeenCalledWith(CONTATO_COM_CIDADE);
      expect(findCityById).not.toHaveBeenCalled();
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ avisoCidade: null }));
    });


    // Envio automatico e contexto da IA precisam usar A MESMA escolha: se cada
    // lado consultasse por conta, o cliente podia receber o aviso do povoado e
    // a IA raciocinar com o do municipio no mesmo atendimento.
    test('quando vence o aviso da localidade, o turno recebe o nome da LOCALIDADE', async () => {
      findContactById.mockResolvedValue({ ...CONTATO_COM_CIDADE, localityId: 'loc-1' });
      selecionarAvisoDoContato.mockResolvedValue({
        aviso: { id: 'n-loc', message: 'Falha no povoado.' }, lugarId: 'loc-1',
      });
      findCityById.mockResolvedValue({ id: 'loc-1', name: 'Barão de Tromaí' });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(findCityById).toHaveBeenCalledWith('loc-1');
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
        avisoCidade: { cidade: 'Barão de Tromaí', mensagem: 'Falha no povoado.' },
      }));
    });

    test('o worker nao decide sozinho: usa a selecao do servico, e so ela', async () => {
      const contato = { ...CONTATO_COM_CIDADE, localityId: 'loc-1' };
      findContactById.mockResolvedValue(contato);
      selecionarAvisoDoContato.mockResolvedValue(null);

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(selecionarAvisoDoContato).toHaveBeenCalledWith(contato);
      expect(findCityById).not.toHaveBeenCalled();
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ avisoCidade: null }));
    });

    test('uma falha no aviso não derruba o turno', async () => {
      findContactById.mockResolvedValue(CONTATO_COM_CIDADE);
      enviarAvisoDeCidadeSePreciso.mockRejectedValue(new Error('db unavailable'));
      const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ avisoCidade: null }));
      expect(enqueueOutboundMessage).toHaveBeenCalled();
      erroSpy.mockRestore();
    });
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

  // Desde 2026-09-16 a saudação só existe na primeira resposta (da segunda
  // em diante ela é removida), então a correção de período é testada no
  // primeiro turno, com o modelo cumprimentando pelo período errado.
  test('saudação do período errado é corrigida ("Bom dia" às 14h)', async () => {
    const { saudacaoDaHora } = jest.requireActual('../ai/saudacao');
    const certa = saudacaoDaHora();
    const errada = certa === 'Bom dia' ? 'Boa noite' : 'Bom dia';
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Willemberg', contracts: [] });
    getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 0 });
    runAiTurn.mockResolvedValue({ texto: `${errada}, Willemberg! Verifiquei aqui que sua conexão está offline.`, toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: `${certa}, Willemberg! Verifiquei aqui que sua conexão está offline.` }));
  });

  // Print 2026-09-17: o cliente mandou o CPF e a IA entregou o boleto sem
  // nunca chamá-lo pelo nome — a identidade tinha sido descoberta DENTRO do
  // turno (buscar_cliente), e o worker só olhava a identidade de antes dele.
  test('o nome descoberto durante o turno vale para a saudação garantida', async () => {
    resolverIdentidade.mockResolvedValue({ nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] });
    runAiTurn.mockResolvedValue({
      texto: 'Enviei acima o boleto em PDF.', toolsExecutadas: [{ nome: 'enviar_boleto' }], erro: null, triagemConcluida: null,
      identidade: { nivel: 'forte', origem: 'cpf', primeiroNome: 'Priscila', contracts: [] },
    });

    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Priscila'),
    }));
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

  test('a identidade devolvida pelo turno (com o CPF do cliente) nunca é logada nem persistida pelo worker', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    runAiTurn.mockResolvedValue({
      texto: 'Perfeito.', toolsExecutadas: [], erro: null, triagemConcluida: null,
      identidade: { nivel: 'forte', origem: 'cpf', client: { document: '52998224725' } },
    });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    const tudoLogado = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join(' ');
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

  // Task 6, achado 3 da revisão: o bloco que carrega o escopo de terceiro
  // (ai-worker.js, logo depois de resolverIdentidade) não tinha nenhum teste.
  // Quatro caminhos: válido, expirado (descarta E limpa a coluna), ausente
  // (não faz UPDATE à toa) e leitura falhando (o turno não pode travar por
  // causa de um escopo que nem chegou a carregar).
  describe('escopo de terceiro', () => {
    const FUTURO = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const PASSADO = new Date(Date.now() - 60 * 1000).toISOString();

    // Identidade confirmada é FATO DO SISTEMA (ajuste de 25/09/2026): buscar_cliente grava o escopo do
    // terceiro localizado ANTES de devolver; o worker lê dele a hora da localização (expiraEm menos a
    // vida do escopo) e passa ao turno — nada disso depende da resposta da IA ter sido enviada.
    describe('hora da localização do terceiro, lida do escopo persistido', () => {
      test('escopo com contrato: o turno recebe a hora em que o terceiro foi localizado', async () => {
        const expiraEm = new Date(Date.now() + 20 * 60 * 1000);
        getThirdPartyScope.mockResolvedValue({ nome: 'Maria', contratos: [77], expiraEm: expiraEm.toISOString() });
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
          terceiroLocalizadoEm: new Date(expiraEm.getTime() - 30 * 60 * 1000),
        }));
      });

      test('escopo pendente (documento não localizado) ou nenhum escopo: sem hora de localização', async () => {
        getThirdPartyScope.mockResolvedValue({ nome: null, contratos: [], pendente: true, expiraEm: FUTURO });
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(runAiTurn).toHaveBeenLastCalledWith(expect.objectContaining({ terceiroLocalizadoEm: null }));
        getThirdPartyScope.mockResolvedValue(null);
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(runAiTurn).toHaveBeenLastCalledWith(expect.objectContaining({ terceiroLocalizadoEm: null }));
      });

      test('o cliente voltou à própria cobrança (escopo limpo): sem hora de localização', async () => {
        getThirdPartyScope.mockResolvedValue({ nome: 'Maria', contratos: [77], expiraEm: FUTURO });
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, terceiroLocalizadoEm: null }));
      });

      test('2. o turno que localizou teve a resposta DESCARTADA (anti-repetição): o turno seguinte ainda recebe a localização', async () => {
        // Turno 1: buscar_cliente (dentro do turno) grava o escopo — aqui, o que a ferramenta faz de verdade.
        let gravado = null;
        getThirdPartyScope.mockImplementation(async () => gravado);
        setThirdPartyScope.mockImplementation(async (_id, escopo) => { gravado = escopo; });
        runAiTurn.mockImplementationOnce(async () => {
          gravado = { nome: 'Maria', contratos: [77], expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
          return { texto: 'Localizei o contrato no CPF informado.', toolsExecutadas: [{ nome: 'buscar_cliente' }], erro: null, triagemConcluida: null, pedidoDeDocumento: null };
        });
        listRecentMessagesByConversation.mockResolvedValue([{ direction: 'outbound', sentBy: 'ai', content: 'Localizei o contrato no CPF informado.' }]);
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        expect(enqueueOutboundMessage).not.toHaveBeenCalled();

        // Turno 2: nenhuma resposta foi salva, e mesmo assim o fato está lá.
        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
        const segundo = runAiTurn.mock.calls[1][0];
        expect(segundo.terceiroLocalizadoEm).toBeInstanceOf(Date);
        expect(segundo.terceiro).toEqual({ nome: 'Maria', contratos: [{ id: 77 }] });
      });
    });

    test('escopo válido: runAiTurn recebe terceiro preenchido, e nada é limpo', async () => {
      getThirdPartyScope.mockResolvedValue({ nome: 'Maria', contratos: [77], expiraEm: FUTURO });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
        terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
      }));
      expect(setThirdPartyScope).not.toHaveBeenCalled();
    });

    test('escopo expirado: descarta (terceiro: null) e limpa a coluna', async () => {
      getThirdPartyScope.mockResolvedValue({ nome: 'Maria', contratos: [77], expiraEm: PASSADO });

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null }));
      expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null);
    });

    test('sem escopo: terceiro null, e nenhuma chamada de limpeza (não faz UPDATE à toa)', async () => {
      getThirdPartyScope.mockResolvedValue(null);

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null }));
      expect(setThirdPartyScope).not.toHaveBeenCalled();
    });

    test('leitura do escopo falhando: o turno acontece mesmo assim, com terceiro null', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      getThirdPartyScope.mockRejectedValue(new Error('banco fora'));

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null }));
      expect(setThirdPartyScope).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    // Caso Fulana/Beltrana (decisão do dono, 25/09/2026): o terceiro é GRUDENTO. O worker lê a
    // intenção explícita na mensagem do cliente (financial-target.js) no começo do turno.
    describe('alvo financeiro do turno', () => {
      const ESCOPO = { nome: 'Beltrana', contratos: [77], expiraEm: FUTURO };

      test('"manda o boleto também": continua o terceiro, nada é limpo', async () => {
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto também' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] }, alvoAmbiguo: false }));
        expect(setThirdPartyScope).not.toHaveBeenCalled();
      });

      test('"agora manda o meu pix": volta ao titular — limpa o escopo, sem pedir CPF', async () => {
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'agora manda o meu pix' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null);
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
      });

      test('áudio transcrito com a intenção própria também volta ao titular', async () => {
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'audio', content: null, transcription: 'quero a minha fatura agora' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null }));
      });

      test('"manda o meu e o dela": ambíguo — mantém o terceiro e trava a cobrança do turno', async () => {
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o meu e o dela' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] }, alvoAmbiguo: true }));
        expect(setThirdPartyScope).not.toHaveBeenCalled();
      });

      test('a limpeza falhou: segue no terceiro (o lado seguro) e registra', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'agora o meu' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] } }));
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
      });
    });
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
      // F (caso ER): a conversa em triagem ESTÁ na fila do atendente (aba Automação); encerrar
      // sem queue:removed deixava o item fantasma até recarregar a página.
      expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'c-1' });
    });

    test('timeout sem nada entregue conclui para a fila como hoje', async () => {
      motivoDeEncerramentoAtivo.mockResolvedValue('rr-1');

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(closeConversationByAi).not.toHaveBeenCalled();
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ summary: expect.stringMatching(/IA indisponível/) }));
      // H: vai para a fila (Espera) pelo queue:new; queue:removed a tiraria de onde ela tem de estar.
      expect(broadcast).toHaveBeenCalledWith('queue:new', expect.objectContaining({ conversation: expect.any(Object) }));
      expect(broadcast).not.toHaveBeenCalledWith('queue:removed', expect.anything());
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
      expect(broadcast).not.toHaveBeenCalled();
      expect(concludeAiTriage).not.toHaveBeenCalled();
    });
  });

  // Caso ER (25/09/2026, produção): o job de segurança nasce UMA vez, com a conversa, e
  // disparava T0 + prazo mesmo com cliente e IA conversando. Conversa 1: criada 13:08:35.922,
  // cliente 13:13:18, IA 13:13:30, fechada 13:13:35.961 como "cliente não respondeu".
  // Regra: um timeout antigo nunca fecha nem move uma conversa com atividade mais recente —
  // relê a última mensagem (qualquer direção) e, se o prazo ainda não passou, reagenda.
  describe('timeout da triagem e atividade recente (caso ER)', () => {
    const MIN = 60000;
    const T0 = Date.parse('2026-09-25T16:08:35.922Z'); // 13:08:35.922 em São Paulo
    const agoraEm = (ms) => jest.spyOn(Date, 'now').mockReturnValue(ms);
    const RESUMO_SEM_RESPOSTA = 'Resolvido pela IA (boleto/PIX entregue); cliente não respondeu e o atendimento foi encerrado sem atendente.';

    beforeEach(() => {
      getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: 'k', model: 'm', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 5, transcriptionFeedAi: true });
      motivoDeEncerramentoAtivo.mockResolvedValue('rr-1');
      getConversationWithContact.mockResolvedValue({ ...PENDING, aiTriageResolvedByAi: true });
      findLastMessageCreatedAt.mockReset();
      enqueueTriageTimeout.mockReset().mockResolvedValue(undefined);
    });

    // Só os espiões deste bloco: os mocks de módulo do arquivo continuam como estão.
    afterEach(() => {
      if (jest.isMockFunction(Date.now)) Date.now.mockRestore();
      if (jest.isMockFunction(console.error)) console.error.mockRestore();
    });

    const nadaAconteceu = () => {
      expect(closeConversationByAi).not.toHaveBeenCalled();
      expect(concludeAiTriage).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
      expect(broadcastToDashboard).not.toHaveBeenCalled();
    };

    test('CASO ER: o job de T0+5 não fecha (cliente 13:13:18, IA 13:13:30) e reagenda para 13:18:30; depois do prazo inteiro de silêncio, encerra e tira da fila', async () => {
      const respostaDaIa = new Date('2026-09-25T16:13:30.000Z');
      findLastMessageCreatedAt.mockResolvedValue(respostaDaIa);
      agoraEm(T0 + 5 * MIN);

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(findLastMessageCreatedAt).toHaveBeenCalledWith('c-1');
      expect(enqueueTriageTimeout).toHaveBeenCalledWith({ conversationId: 'c-1', delayMs: respostaDaIa.getTime() + 5 * MIN - (T0 + 5 * MIN) });

      // O novo job, 5 minutos depois da última atividade, sem nenhuma mensagem nova.
      jest.clearAllMocks();
      findLastMessageCreatedAt.mockResolvedValue(respostaDaIa);
      agoraEm(respostaDaIa.getTime() + 5 * MIN);

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(closeConversationByAi).toHaveBeenCalledWith('c-1', { reasonId: 'rr-1', summary: RESUMO_SEM_RESPOSTA });
      expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'c-1' });
      expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', expect.objectContaining({ closedAt: expect.any(String) }));
      expect(enqueueTriageTimeout).not.toHaveBeenCalled();
    });

    test('A — prazo inteiro de silêncio desde a última mensagem: age como hoje (sem entrega, conclui para a fila)', async () => {
      getConversationWithContact.mockResolvedValue(PENDING);
      agoraEm(T0 + 10 * MIN);
      findLastMessageCreatedAt.mockResolvedValue(new Date(T0 + 5 * MIN - 1000));

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ summary: expect.stringMatching(/IA indisponível/) }));
      expect(broadcast).toHaveBeenCalledWith('queue:new', expect.any(Object));
      expect(enqueueTriageTimeout).not.toHaveBeenCalled();
    });

    test('B — cliente falou perto do prazo: o job antigo não fecha nem move, reagenda e não avisa ninguém (G)', async () => {
      agoraEm(T0 + 5 * MIN);
      findLastMessageCreatedAt.mockResolvedValue(new Date(T0 + 5 * MIN - 10000));

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(enqueueTriageTimeout).toHaveBeenCalledWith({ conversationId: 'c-1', delayMs: 5 * MIN - 10000 });
    });

    // A consulta considera as duas direções (message.repository.test: findLastMessageCreatedAt);
    // aqui, a última atividade é a resposta da IA numa conversa sem entrega.
    test('C — a IA respondeu perto do prazo: o job antigo não manda para a fila, reagenda', async () => {
      getConversationWithContact.mockResolvedValue(PENDING);
      agoraEm(T0 + 5 * MIN);
      findLastMessageCreatedAt.mockResolvedValue(new Date(T0 + 5 * MIN - 3000));

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(enqueueTriageTimeout).toHaveBeenCalledWith({ conversationId: 'c-1', delayMs: 5 * MIN - 3000 });
    });

    test('D — boleto/Pix entregue e a conversa continua: nenhum job fecha enquanto não houver um prazo inteiro de silêncio', async () => {
      // Três jobs seguidos, cada um encontrando atividade dentro do prazo.
      for (const [agora, ultima] of [[T0 + 5 * MIN, T0 + 4 * MIN], [T0 + 9 * MIN, T0 + 8 * MIN], [T0 + 13 * MIN, T0 + 12 * MIN + 30000]]) {
        agoraEm(agora);
        findLastMessageCreatedAt.mockResolvedValue(new Date(ultima));
        await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
      }
      nadaAconteceu();
      expect(enqueueTriageTimeout).toHaveBeenCalledTimes(3);
    });

    test('reagendamento nunca vira loop apertado: faltando milissegundos, espera o mínimo técnico', async () => {
      agoraEm(T0 + 5 * MIN);
      findLastMessageCreatedAt.mockResolvedValue(new Date(T0 + 200)); // faltam 200 ms

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(enqueueTriageTimeout).toHaveBeenCalledWith({ conversationId: 'c-1', delayMs: 5000 });
    });

    test('horário de mensagem no futuro (relógio do provedor): reagenda no máximo um prazo à frente', async () => {
      agoraEm(T0);
      findLastMessageCreatedAt.mockResolvedValue(new Date(T0 + 60 * MIN));

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(enqueueTriageTimeout).toHaveBeenCalledWith({ conversationId: 'c-1', delayMs: 5 * MIN });
    });

    test.each([
      ['atribuída a atendente (modo Assistente)', { ...PENDING, status: 'assigned', assignedAgentId: 'a-1', triageState: 'completed' }],
      ['na fila, triagem já concluída', { ...PENDING, triageState: 'completed' }],
      ['encerrada', { ...PENDING, status: 'closed', triageState: 'completed' }],
    ])('I — conversa %s: o timeout não interfere', async (_nome, conversa) => {
      getConversationWithContact.mockResolvedValue(conversa);
      agoraEm(T0 + 5 * MIN);

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(findLastMessageCreatedAt).not.toHaveBeenCalled();
      expect(enqueueTriageTimeout).not.toHaveBeenCalled();
    });

    test('J — reagendamento falhou: registra o erro e NÃO fecha nem move a conversa', async () => {
      agoraEm(T0 + 5 * MIN);
      findLastMessageCreatedAt.mockResolvedValue(new Date(T0 + 5 * MIN - 10000));
      enqueueTriageTimeout.mockRejectedValue(new Error('redis fora'));
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(erro.mock.calls.flat().join(' ')).toMatch(/reschedule triage timeout/i);
    });

    test('J — leitura da última atividade falhou: na dúvida preserva a conversa, tenta reagendar e registra', async () => {
      agoraEm(T0 + 5 * MIN);
      findLastMessageCreatedAt.mockRejectedValue(new Error('banco fora'));
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });

      nadaAconteceu();
      expect(enqueueTriageTimeout).toHaveBeenCalledWith({ conversationId: 'c-1', delayMs: 5 * MIN });
      expect(erro).toHaveBeenCalled();
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

    // Revisão final do branch: o turno pode estourar o tempo (TURNO_MAX_MS)
    // DEPOIS de a liberação acontecer no SGP e ANTES de o modelo escrever o
    // "prontinho". O cliente ficava sem resposta nenhuma, com a internet
    // liberada, e a conversa sem ir para a fila da manhã.
    describe('turno estourou o tempo depois da liberação', () => {
      const NOTURNO = { mode: 'assistant', apiKey: 'k', model: 'm', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3, transcriptionFeedAi: true, nightStartTime: '20:00', nightEndTime: '08:00' };

      beforeEach(() => {
        isNightModeActive.mockReturnValue(true);
        getAiConfig.mockResolvedValue(NOTURNO);
        resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Willemberg', contracts: [] });
      });

      test('sem texto mas com liberação feita: o código manda a frase do dono e conclui na fila', async () => {
        runAiTurn.mockResolvedValue({ texto: null, toolsExecutadas: [], erro: 'turn_timeout', triagemConcluida: null, desbloqueioRealizado: true });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledWith({
          conversationId: 'c-1', channelId: 'ch-1', sentBy: 'ai',
          content: 'Prontinho, Willemberg! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das 08:00. Já deixei seu atendimento na fila com o comprovante para acompanhamento. Você consegue testar se a internet voltou?',
        });
        expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({
          summary: expect.stringMatching(/desbloqueio em confiança realizado/i),
        }));
        expect(broadcast).toHaveBeenCalledWith('queue:new', expect.any(Object));
        // A frase já é o desfecho: não conta como mais uma pergunta da triagem.
        expect(incrementTriageAttempts).not.toHaveBeenCalled();
      });

      test('sem texto e sem liberação: nada é enviado e nada é concluído (comportamento de hoje)', async () => {
        runAiTurn.mockResolvedValue({ texto: null, toolsExecutadas: [], erro: 'turn_timeout', triagemConcluida: null, desbloqueioRealizado: false });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).not.toHaveBeenCalled();
        expect(concludeAiTriage).not.toHaveBeenCalled();
      });

      test('com texto do modelo, a frase do código não entra: quem fala é o turno', async () => {
        runAiTurn.mockResolvedValue({ texto: 'Prontinho, Willemberg! Testa a internet aí.', toolsExecutadas: [], erro: null, triagemConcluida: null, desbloqueioRealizado: true });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
        expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
          content: expect.stringContaining('Testa a internet aí.'),
        }));
        expect(concludeAiTriage).not.toHaveBeenCalled();
      });

      test('atendente assumiu durante o turno: nem a frase do código sai', async () => {
        runAiTurn.mockResolvedValue({ texto: null, toolsExecutadas: [], erro: 'turn_timeout', triagemConcluida: null, desbloqueioRealizado: true });
        getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, status: 'assigned', assignedAgentId: 'a-1' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).not.toHaveBeenCalled();
        expect(concludeAiTriage).not.toHaveBeenCalled();
      });
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

  // Regra financeira 0/1/2+ (25/09/2026): a conversa marcada para a reativação (cancelado, 2+ de
  // dia, 2+ à noite depois da mais antiga) nunca fecha como "resolvida pela IA" — nem no timeout,
  // nem com o PIX entregue — e a conclusão em código vai para o setor de reativação.
  describe('reativação (regra financeira 0/1/2+)', () => {
    const SETOR_REAT = { id: 's-reat', name: 'Reativação' };
    beforeEach(() => {
      getTriageReactivation.mockResolvedValue('multiplas_vencidas_noturno');
      setorDeReativacao.mockResolvedValue(SETOR_REAT);
      // O bloco do caso ER deixa uma "última mensagem" recente mockada: aqui o prazo já passou.
      findLastMessageCreatedAt.mockReset().mockResolvedValue(null);
    });

    test('20. timeout depois da entrega noturna de 2+: não encerra como resolvido, conclui na reativação', async () => {
      motivoDeEncerramentoAtivo.mockResolvedValue('rr-1');
      getConversationWithContact.mockResolvedValue({ ...PENDING, aiTriageResolvedByAi: true });
      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
      expect(closeConversationByAi).not.toHaveBeenCalled();
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({
        sectorId: 's-reat', resolvedByAi: false, summary: expect.stringMatching(/reativação[\s\S]*mais antiga/i),
      }));
      expect(concludeAiTriage.mock.calls[0][1].summary).not.toMatch(/Resolvido pela IA/);
    });

    test('a leitura da marca falha no timeout: na dúvida, não encerra como resolvido', async () => {
      motivoDeEncerramentoAtivo.mockResolvedValue('rr-1');
      getTriageReactivation.mockRejectedValue(new Error('db fora'));
      getConversationWithContact.mockResolvedValue({ ...PENDING, aiTriageResolvedByAi: true });
      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
      expect(closeConversationByAi).not.toHaveBeenCalled();
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ resolvedByAi: false }));
    });

    test('limite de perguntas com a reativação marcada: a conclusão em código vai para a reativação', async () => {
      getTriageReactivation.mockResolvedValue('multiplas_vencidas');
      getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 2 });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ sectorId: 's-reat', resolvedByAi: false }));
    });

    test('sem setor de reativação cadastrado: fila geral como antes, com o motivo no resumo', async () => {
      setorDeReativacao.mockResolvedValue(null);
      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ sectorId: null, summary: expect.stringMatching(/reativação/i) }));
    });

    // Ajuste de 25/09/2026: a marca vai ao turno — o prompt não pode mandar para o financeiro (regra
    // dos 90 dias) uma conversa que o gate mandou para a reativação.
    test('o turno recebe a marca de reativação da conversa', async () => {
      getTriageReactivation.mockResolvedValue('multiplas_vencidas');
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ reativacao: 'multiplas_vencidas' }));
    });

    test('a leitura da marca falha: o turno roda sem ela (as ferramentas ainda leem do banco)', async () => {
      getTriageReactivation.mockRejectedValue(new Error('db fora'));
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ reativacao: null }));
    });

    test('sem reativação marcada, nada muda (fila geral, mesmo resumo)', async () => {
      getTriageReactivation.mockResolvedValue(null);
      await handleAiJob({ conversationId: 'c-1', tipo: 'triage-timeout' });
      expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({
        sectorId: null, summary: 'Triagem não concluída: IA indisponível. Atender normalmente.',
      }));
      expect(setorDeReativacao).not.toHaveBeenCalled();
    });
  });
});

// A IA passou a nao sugerir resposta quando um atendente assume: e a chave
// assistantSuggestionsEnabled, separada do `mode` porque desligar pelo modo
// levaria junto a triagem e a transcricao.
describe('sugestao para o atendente e opcional', () => {
  const CONVERSA = {
    id: 'conv-1',
    contactId: 'contact-1',
    channelId: 'channel-1',
    status: 'assigned',
    assignedAgentId: 'agent-1',
    triageState: 'completed',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getConversationWithContact.mockResolvedValue(CONVERSA);
    findContactById.mockResolvedValue({ id: 'contact-1' });
    findLatestInboundMessageId.mockResolvedValue('msg-1');
    runAiTurn.mockResolvedValue({ texto: 'Posso ajudar com a segunda via.', toolsExecutadas: [] });
  });

  test('nao cria sugestao quando a chave esta desligada', async () => {
    getAiConfig.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: false });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'msg-1' });

    expect(createSuggestion).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalledWith('agent-1', 'ai:suggestion', expect.anything());
  });

  test('cria sugestao quando a chave esta ligada', async () => {
    getAiConfig.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: true });
    createSuggestion.mockResolvedValue({ id: 'sug-1', content: 'Posso ajudar com a segunda via.' });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'msg-1' });

    expect(createSuggestion).toHaveBeenCalled();
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'ai:suggestion', expect.anything());
  });

  // Config antiga (sem o campo) nao pode virar sugestao ligada por acidente.
  test('config sem a chave nao sugere', async () => {
    getAiConfig.mockResolvedValue({ mode: 'assistant' });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'msg-1' });

    expect(createSuggestion).not.toHaveBeenCalled();
  });
});

// Contencao de 2026-09-22: no assistente, acao virou proposta. A tentativa
// precisa ficar VISIVEL para a atendente — inclusive quando o modelo nao
// escreve nada, que antes fazia o turno inteiro sumir (`if (!texto) return`).
describe('ai-worker — assistente: acao bloqueada nao pode sumir', () => {
  const CONVERSA = {
    id: 'conv-1', contactId: 'ct-1', channelId: 'ch-1',
    status: 'waiting', triageState: 'completed', assignedAgentId: 'ag-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getConversationWithContact.mockResolvedValue(CONVERSA);
    getAiConfig.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: true, transcriptionFeedAi: false });
    findLatestInboundMessageId.mockResolvedValue('m-1');
    findContactById.mockResolvedValue({ id: 'ct-1' });
    createSuggestion.mockResolvedValue({ id: 's-1', content: 'x', acoesExecutadas: [] });
  });

  test('com texto e acao bloqueada, a sugestao registra a acao proposta', async () => {
    runAiTurn.mockResolvedValue({
      texto: 'Posso liberar o acesso em confiança deste contrato, confirma?',
      toolsExecutadas: [],
      toolsRecusadas: [{ nome: 'desbloqueio_confianca', motivo: 'action_requires_human_approval' }],
    });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'm-1' });

    expect(createSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      acoesPropostas: ['desbloqueio_confianca'],
    }));
  });

  // Era aqui que a tentativa sumia: sem texto, o worker saia antes de criar
  // qualquer registro — e, no mundo antigo, a acao JA tinha acontecido.
  test('SEM texto, mas com acao bloqueada, ainda cria sugestao visivel', async () => {
    runAiTurn.mockResolvedValue({
      texto: '',
      toolsExecutadas: [],
      toolsRecusadas: [{ nome: 'desbloqueio_confianca', motivo: 'action_requires_human_approval' }],
    });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'm-1' });

    expect(createSuggestion).toHaveBeenCalled();
    const arg = createSuggestion.mock.calls[0][0];
    expect(arg.content).toMatch(/desbloqueio_confianca/);
    expect(arg.content).toMatch(/não foi executada|nao foi executada/i);
  });

  test('SEM texto e SEM acao nenhuma continua nao criando sugestao', async () => {
    runAiTurn.mockResolvedValue({ texto: '', toolsExecutadas: [], toolsRecusadas: [] });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'm-1' });

    expect(createSuggestion).not.toHaveBeenCalled();
  });

  test('recusa que NAO e de aprovacao humana nao vira acao proposta', async () => {
    runAiTurn.mockResolvedValue({
      texto: 'Não consegui consultar agora.',
      toolsExecutadas: [],
      toolsRecusadas: [{ nome: 'consultar_faturas', motivo: 'invalid_args' }],
    });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'm-1' });

    expect(createSuggestion).toHaveBeenCalledWith(expect.objectContaining({ acoesExecutadas: [] }));
  });

  test('acao realmente executada continua sendo registrada como executada', async () => {
    runAiTurn.mockResolvedValue({
      texto: 'Pronto.',
      toolsExecutadas: [{ nome: 'consultar_plano' }],
      toolsRecusadas: [],
    });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'm-1' });

    expect(createSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      acoesExecutadas: ['consultar_plano'],
    }));
  });
});

// Requisito 8 do dono: nenhuma sugestão pode declarar sucesso de uma ação
// bloqueada. A frase do modelo não dá para prender em teste, mas a lista
// `acoesExecutadas` dá — e é ela que a tela mostra como "o que a IA fez".
describe('ai-worker — ação bloqueada nunca aparece como executada', () => {
  const CONVERSA = {
    id: 'conv-1', contactId: 'ct-1', channelId: 'ch-1',
    status: 'waiting', triageState: 'completed', assignedAgentId: 'ag-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getConversationWithContact.mockResolvedValue(CONVERSA);
    getAiConfig.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: true, transcriptionFeedAi: false });
    findLatestInboundMessageId.mockResolvedValue('m-1');
    findContactById.mockResolvedValue({ id: 'ct-1' });
    createSuggestion.mockResolvedValue({ id: 's-1', content: 'x', acoesExecutadas: [] });
  });

  test('o nome da ação bloqueada NUNCA entra cru na lista de executadas', async () => {
    runAiTurn.mockResolvedValue({
      texto: 'Dá para liberar; confirma?',
      toolsExecutadas: [{ nome: 'consultar_plano' }],
      toolsRecusadas: [{ nome: 'desbloqueio_confianca', motivo: 'action_requires_human_approval' }],
    });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'm-1' });

    const { acoesExecutadas, acoesPropostas } = createSuggestion.mock.calls[0][0];
    // `acoesExecutadas` é rotulada no passado pelo card: um nome bloqueado ali
    // vira "executada no SGP" na tela da atendente.
    expect(acoesExecutadas).not.toContain('desbloqueio_confianca');
    expect(acoesExecutadas).toContain('consultar_plano');
    expect(acoesPropostas).toContain('desbloqueio_confianca');
  });

  // Executada e bloqueada com o MESMO nome no mesmo turno (o modelo insistiu):
  // a entrada crua tem de continuar sendo só a que executou de verdade.
  test('mesma ferramenta executada e bloqueada: cada uma com sua marca', async () => {
    runAiTurn.mockResolvedValue({
      texto: 'ok',
      toolsExecutadas: [{ nome: 'transferir_atendimento' }],
      toolsRecusadas: [{ nome: 'transferir_atendimento', motivo: 'action_requires_human_approval' }],
    });

    await handleAiJob({ conversationId: 'conv-1', messageId: 'm-1' });

    const { acoesExecutadas, acoesPropostas } = createSuggestion.mock.calls[0][0];
    expect(acoesExecutadas).toEqual(['transferir_atendimento']);
    expect(acoesPropostas).toEqual(['transferir_atendimento']);
  });
});
