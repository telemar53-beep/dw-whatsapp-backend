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

const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const { motivoDeEncerramentoAtivo } = require('../ai/triage-close-reason');
const {
  getConversationWithContact, concludeAiTriage, incrementTriageAttempts, isPhoneContested,
  closeConversationByAi, getThirdPartyScope, setThirdPartyScope,
} = require('../conversations/conversation.repository');
const { findContactById } = require('../conversations/contact.repository');
const { findLatestInboundMessageId, findMessageById, listRecentMessagesByConversation } = require('../conversations/message.repository');
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
  });

  // Idempotência de enviar_boleto/gerar_pix: o turno precisa saber QUAL
  // mensagem do cliente o abriu. É esse id que separa "o cliente pediu o
  // reenvio agora" de "o modelo chamou a ferramenta duas vezes na mesma
  // mensagem". O worker já o tem em mãos, e já conferiu (logo acima) que é a
  // mensagem inbound mais recente.
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
