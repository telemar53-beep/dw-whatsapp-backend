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
jest.mock('../company/company-config.repository');

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
const {
  findLatestInboundMessageId, findMessageById, listRecentMessagesByConversation, findLastMessageCreatedAt, listarFalasSemAlvoConfirmado,
  marcarFalasComAlvoProcessado,
} = require('../conversations/message.repository');
const { getCompanyConfig } = require('../company/company-config.repository');
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

// Persistência do alvo (03/10/2026): toda gravação do escopo pelo worker é condicional ao estado lido, e cada
// escopo gravado leva uma marca nova. As asserções conferem as duas coisas.
const GRAVACAO_CONDICIONAL = expect.objectContaining({ esperados: expect.any(Array) });
const VOLTA_CONDICIONAL = expect.objectContaining({ esperados: expect.any(Array), aceitaNulo: true });
const comMarca = (escopo) => ({ ...escopo, marca: expect.any(String) });

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
    // Persistência do alvo (03/10/2026): a gravação condicional devolve se gravou; só `true` confirma.
    setThirdPartyScope.mockResolvedValue(true);
    // Terceira revisão da F2: a marca das entradas processadas. Default benigno, pelo mesmo motivo.
    marcarFalasComAlvoProcessado.mockReset().mockResolvedValue();
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
  // Comportamento da IA (05/10/2026; avaliação real E15 #1): a oferta do boleto (PIX sem código) fica marcada na própria
  // mensagem, com a fatura — é por ela que o turno seguinte sabe que a oferta já foi feita.
  describe('oferta do boleto marcada na própria mensagem', () => {
    test('a resposta que ofereceu o boleto sai com a marca da fatura', async () => {
      runAiTurn.mockResolvedValue({ texto: 'Não há PIX para esta fatura agora. Posso te enviar o boleto dela?', toolsExecutadas: [], erro: null, triagemConcluida: null, pedidoDeDocumento: null, ofertaDoBoleto: { faturaId: '9' } });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ sentBy: 'ai', metadata: { ofertaDoBoleto: { faturaId: '9' } } }));
    });

    // D8 (06/10/2026): a marca com a lista das faturas sai inteira na metadata (duas ofertas pendentes).
    test('a marca com duas ofertas pendentes sai com a lista inteira', async () => {
      runAiTurn.mockResolvedValue({ texto: 'Para as duas faturas não há PIX agora. Posso te enviar os boletos delas?', toolsExecutadas: [], erro: null, triagemConcluida: null, pedidoDeDocumento: null, ofertaDoBoleto: { faturaId: '10', faturaIds: ['9', '10'] } });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ metadata: { ofertaDoBoleto: { faturaId: '10', faturaIds: ['9', '10'] } } }));
    });

    test('com o pedido de documento no mesmo turno, as duas marcas saem juntas', async () => {
      runAiTurn.mockResolvedValue({ texto: 'Posso te enviar o boleto? E me informe o CPF do titular.', toolsExecutadas: [], erro: null, triagemConcluida: null, pedidoDeDocumento: { alvo: 'principal' }, ofertaDoBoleto: { faturaId: '9' } });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ metadata: { pedidoDeDocumento: { alvo: 'principal' }, ofertaDoBoleto: { faturaId: '9' } } }));
    });
  });

  // Comportamento da IA (06/10/2026; A6/A7): o estado dos meios que a 2ª via comprovou viaja na metadata da mensagem.
  describe('meios de pagamento comprovados na própria mensagem', () => {
    test('a resposta sai com o estado dos meios do turno', async () => {
      const meios = [{ contratoId: '17402', faturaId: '9', pix: false, boleto: false }];
      runAiTurn.mockResolvedValue({ texto: 'Esta fatura não tem PIX nem boleto disponível por aqui agora.', toolsExecutadas: [], erro: null, triagemConcluida: null, pedidoDeDocumento: null, meiosDaFatura: meios });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ sentBy: 'ai', metadata: { meiosDaFatura: meios } }));
    });

    test('sem estado, a mensagem sai sem metadata de meios', async () => {
      runAiTurn.mockResolvedValue({ texto: 'Posso ajudar em algo mais?', toolsExecutadas: [], erro: null, triagemConcluida: null, pedidoDeDocumento: null, meiosDaFatura: null });
      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
      expect(enqueueOutboundMessage.mock.calls[0][0].metadata).toBeUndefined();
    });
  });

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
        { id: 'm-3', direction: 'inbound', content: '44455566619' },
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
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Joaquim', contracts: [] });
    runAiTurn.mockResolvedValue({ texto: 'Enviei o PIX da sua fatura. Precisa de mais alguma coisa?', toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/^(Bom dia|Boa tarde|Boa noite), Joaquim! Enviei o PIX da sua fatura\./),
    }));
  });

  test('com o SGP fora, a saudação ainda sai com o nome guardado na memória', async () => {
    // O identity-resolver devolve a memória (sgpIndisponivel) em vez de
    // 'none': o worker não muda, mas é este caminho que impede o cliente
    // vinculado de ouvir "me informe seu CPF" quando o SGP cai.
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'memory', primeiroNome: 'Joaquim', contracts: [], sgpIndisponivel: true });
    runAiTurn.mockResolvedValue({ texto: 'Nosso sistema de consulta está instável agora. Já encaminhei ao Suporte.', toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/^(Bom dia|Boa tarde|Boa noite), Joaquim! Nosso sistema de consulta está instável agora\./),
    }));
  });

  // Desde 2026-09-16 a saudação só existe na primeira resposta (da segunda
  // em diante ela é removida), então a correção de período é testada no
  // primeiro turno, com o modelo cumprimentando pelo período errado.
  test('saudação do período errado é corrigida ("Bom dia" às 14h)', async () => {
    const { saudacaoDaHora } = jest.requireActual('../ai/saudacao');
    const certa = saudacaoDaHora();
    const errada = certa === 'Bom dia' ? 'Boa noite' : 'Bom dia';
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Joaquim', contracts: [] });
    getConversationWithContact.mockResolvedValue({ ...PENDING, triageAttempts: 0 });
    runAiTurn.mockResolvedValue({ texto: `${errada}, Joaquim! Verifiquei aqui que sua conexão está offline.`, toolsExecutadas: [], erro: null, triagemConcluida: null });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ content: `${certa}, Joaquim! Verifiquei aqui que sua conexão está offline.` }));
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
    resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Joaquim', contracts: [] });
    // A saudação do período certo para a hora em que o teste roda: o worker
    // agora corrige "Bom dia" às 14h, então o texto precisa já vir certo.
    const { saudacaoDaHora } = jest.requireActual('../ai/saudacao');
    const jaCumprimenta = `${saudacaoDaHora()}, Joaquim! Me diz o endereço.`;
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
        setThirdPartyScope.mockImplementation(async (_id, escopo) => { gravado = escopo; return true; });
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
      expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
    });

    test('sem escopo: terceiro null, e nenhuma chamada de limpeza (não faz UPDATE à toa)', async () => {
      getThirdPartyScope.mockResolvedValue(null);

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null }));
      expect(setThirdPartyScope).not.toHaveBeenCalled();
    });

    test('leitura do escopo falhando: o turno acontece mesmo assim, com terceiro null — mas a cobrança do turno trava', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      getThirdPartyScope.mockRejectedValue(new Error('banco fora'));

      await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

      // Revisão da F2: falha de leitura não prova que não havia terceiro nem dúvida gravada.
      expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: 'escopo_nao_lido' }));
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

        expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
      });

      test('áudio transcrito com a intenção própria também volta ao titular', async () => {
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'audio', content: null, transcription: 'quero a minha fatura agora' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null }));
      });

      test('"manda o meu e o dela": ambíguo — mantém o terceiro, trava a cobrança e grava a dúvida (revisão da F2)', async () => {
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o meu e o dela' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
          // Rodada 8 (N1): a dúvida gravada neste turno guarda a entrada que a originou.
          terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }], alvoPendente: 'dois_lados', duvidaDesde: 'm-1' }, alvoAmbiguo: 'dois_lados',
        }));
        // O escopo não é limpo: só ganha a dúvida, com o mesmo prazo.
        expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', comMarca({ ...ESCOPO, alvoPendente: 'dois_lados', duvidaDesde: 'm-1' }), GRAVACAO_CONDICIONAL);
      });

      // F2 (30/09/2026): posse de coisa própria é o próprio — com terceiro registrado, é volta explícita.
      test('"manda o boleto da minha internet": volta ao titular — limpa o escopo', async () => {
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto da minha internet' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
      });

      // Revisão da F2 (30/09/2026): a dúvida sobre o alvo fica gravada no escopo (alvoPendente) — não depende
      // das mensagens lidas, sobrevive a qualquer número de mensagens e ao reinício do worker, e some com o
      // prazo do escopo, que não é renovado.
      describe('dúvida sobre o alvo gravada no escopo', () => {
        const COM_DUVIDA = { ...ESCOPO, alvoPendente: 'terceiro_nao_vinculado' };

        test('"manda o boleto da minha mãe": grava a dúvida no mesmo escopo, sem mexer no prazo nem nos contratos', async () => {
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto da minha mãe' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(setThirdPartyScope).toHaveBeenCalledTimes(1);
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', comMarca({ nome: 'Beltrana', contratos: [77], expiraEm: FUTURO, alvoPendente: 'terceiro_nao_vinculado', duvidaDesde: 'm-1' }), GRAVACAO_CONDICIONAL);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'terceiro_nao_vinculado' }));
        });

        test('reinício do worker: a dúvida vem do banco — "pode mandar" continua travado, sem ler histórico para isso', async () => {
          getThirdPartyScope.mockResolvedValue(COM_DUVIDA);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });
          listRecentMessagesByConversation.mockResolvedValue([]);

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
            terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }], alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: 'terceiro_nao_vinculado',
          }));
          expect(setThirdPartyScope).not.toHaveBeenCalled();
        });

        test('volta explícita ao próprio com a dúvida gravada: limpa o escopo', async () => {
          getThirdPartyScope.mockResolvedValue(COM_DUVIDA);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
        });

        test('dúvida fraca resolvida por "o dela": grava o escopo sem a dúvida e libera o turno', async () => {
          getThirdPartyScope.mockResolvedValue({ ...ESCOPO, alvoPendente: 'referencia_incompleta' });
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o dela' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', comMarca(ESCOPO), GRAVACAO_CONDICIONAL);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] }, alvoAmbiguo: false }));
        });

        test('sem terceiro, "manda o boleto da minha mãe": grava um escopo pendente, sem contrato, com a dúvida e prazo novo', async () => {
          getThirdPartyScope.mockResolvedValue(null);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto da minha mãe' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento', marca: expect.any(String) }), GRAVACAO_CONDICIONAL);
          const [, gravado] = setThirdPartyScope.mock.calls[0];
          expect(Date.parse(gravado.expiraEm) - Date.now()).toBeGreaterThan(29 * 60 * 1000);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'outra_pessoa_sem_documento' }));
        });

        // Pedido por endereço (06/10/2026, autorizado): o worker passa os endereços dos contratos CONFIRMADOS de quem fala para
        // a regra do alvo, e o contrato escolhido pela rua chega ao turno.
        const DOIS_CONTRATOS = {
          nivel: 'forte', origem: 'phone', primeiroNome: 'Sicrano',
          contracts: [{ id: 301, address: 'Rua de Teste, 300 - Bairro de Teste' }, { id: 302, address: 'Avenida de Teste, 30 - Outro Bairro de Teste' }],
        };
        test('pedido pela rua de um contrato dele: segue o titular, com o contrato escolhido no turno, sem gravar escopo', async () => {
          getThirdPartyScope.mockResolvedValue(null);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o pix da Avenida de Teste' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: false, contratoEscolhido: '302' }));
          expect(setThirdPartyScope).not.toHaveBeenCalled();
        });

        // Dúvida de endereço (07/10/2026): gravada entre turnos, no mesmo escopo das dúvidas de alvo.
        const DUVIDA_GRAVADA = { nome: null, contratos: [], pendente: true, alvoPendente: 'endereco_desconhecido', expiraEm: FUTURO, marca: 'marca-duvida' };
        const DUVIDA_NO_TURNO = { nome: null, contratos: [], pendente: true, alvoPendente: 'endereco_desconhecido' };
        test('rua que não é de contrato dele: a dúvida de endereço é gravada (escopo pendente sem contrato) e o turno trava', async () => {
          getThirdPartyScope.mockResolvedValue(null);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o pix da Avenida Central' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({
            nome: null, contratos: [], pendente: true, alvoPendente: 'endereco_desconhecido', marca: expect.any(String),
          }), GRAVACAO_CONDICIONAL);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'endereco_desconhecido', contratoEscolhido: null }));
          // Rodada 8 (N1): a dúvida gravada guarda a entrada que a originou, e o turno recebe as falas novas do cliente.
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ duvidaDesde: 'm-1' }), GRAVACAO_CONDICIONAL);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
            terceiro: expect.objectContaining({ duvidaDesde: 'm-1' }), falasNovasDoCliente: ['manda o pix da Avenida Central'], alvoVoltouAoTitular: false,
          }));
        });

        test('dúvida de endereço gravada + "pode mandar": continua, sem gravar nada e sem liberar', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(setThirdPartyScope).not.toHaveBeenCalled();
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: DUVIDA_NO_TURNO, alvoAmbiguo: 'endereco_desconhecido', contratoEscolhido: null }));
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ duvidaDeEnderecoRespondida: false }));
        });

        // Revisão do v4 (07/10/2026, achado A2): a resposta que tira a dúvida de endereço só é gravada DEPOIS do turno, junto com
        // a marca das entradas. Se o processo cair no meio, a dúvida continua gravada e a resposta é relida sobre ela.
        const ordemDoJob = () => {
          const ordem = [];
          setThirdPartyScope.mockImplementation(async (id, escopo) => { ordem.push(escopo === null ? 'limpar' : 'gravar'); return true; });
          marcarFalasComAlvoProcessado.mockImplementation(async () => { ordem.push('marcar'); });
          runAiTurn.mockImplementation(async () => { ordem.push('turno'); return { texto: 'Pronto.', toolsExecutadas: [], erro: null, triagemConcluida: null }; });
          return ordem;
        };
        test('dúvida de endereço gravada + a rua dele na resposta: o turno segue o titular com o contrato; a dúvida só sai depois do turno', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a da Avenida de Teste' });
          const ordem = ordemDoJob();
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false, contratoEscolhido: '302', contratosEscolhidos: ['302'] }));
          // Revisão da rodada 7 (P2-2): o turno sabe que a dúvida foi respondida (o próprio documento só identifica nele).
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ duvidaDeEnderecoRespondida: true }));
          expect(ordem).toEqual(['turno', 'limpar', 'marcar']);
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, { esperados: [{ marca: 'marca-duvida' }], aceitaNulo: true, semEntradaNova: { ids: ['m-1'], desde: expect.any(Date) } });
        });
        test('a resposta à dúvida e o turno cai no meio: a dúvida continua gravada, nada é marcado, e o reprocessamento relê a mesma resposta com a mesma limitação', async () => {
          const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a da Avenida de Teste' });
          runAiTurn.mockRejectedValueOnce(new Error('o processo caiu'));
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' }).catch(() => {});
          expect(setThirdPartyScope).not.toHaveBeenCalled();
          expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenLastCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false, contratosEscolhidos: ['302'] }));
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, { esperados: [{ marca: 'marca-duvida' }], aceitaNulo: true, semEntradaNova: { ids: ['m-1'], desde: expect.any(Date) } });
          errorSpy.mockRestore();
        });
        test.each([['o estado mudou', () => setThirdPartyScope.mockResolvedValueOnce(false)], ['erro do banco', () => setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'))]])(
          'a limpeza da dúvida depois do turno não foi gravada (%s): as entradas não são marcadas (o próximo turno relê a resposta)', async (_, falhar) => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
            resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a da Avenida de Teste' });
            falhar();
            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
            expect(setThirdPartyScope).toHaveBeenCalledTimes(1);
            expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            errorSpy.mockRestore();
          });
        test.each(['turn_timeout', 'empty_model_response', 'tool_limit_reached'])(
          'a resposta à dúvida e o turno termina com erro (%s): a dúvida continua gravada e nada é marcado (o próximo turno relê a resposta)', async (erro) => {
            getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
            resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a da Avenida de Teste' });
            runAiTurn.mockResolvedValue({ texto: null, toolsExecutadas: [], erro, triagemConcluida: null });
            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
            expect(setThirdPartyScope).not.toHaveBeenCalled();
            expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          });
        // Revisão da v4.1 (achado B3): a limpeza adiada junto com os sinalizadores do turno — quem grava é a recuperação deles.
        test('a resposta à dúvida e buscar_cliente não gravou o pendente no turno: grava o pendente (não limpa), uma gravação só', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a da Avenida de Teste' });
          runAiTurn.mockResolvedValue({ texto: 'Não consegui agora.', toolsExecutadas: [], erro: null, triagemConcluida: null, alvoTerceiroNaoGravado: true });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(setThirdPartyScope).toHaveBeenCalledTimes(1);
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ nome: null, contratos: [], pendente: true }), { esperados: [{ marca: 'marca-duvida' }] });
        });
        test('a resposta à dúvida e a volta ao titular pelo documento não foi gravada no turno: a volta é gravada uma vez só', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a da Avenida de Teste' });
          runAiTurn.mockResolvedValue({ texto: 'Pronto.', toolsExecutadas: [], erro: null, triagemConcluida: null, voltaAoTitularNaoGravada: true });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(setThirdPartyScope).toHaveBeenCalledTimes(1);
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, { esperados: [{ marca: 'marca-duvida' }], aceitaNulo: true });
        });
        test('uma ferramenta do turno gravou outro escopo (o documento de alguém): a dúvida não é limpa por cima dele, e as entradas são marcadas', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a da Avenida de Teste' });
          runAiTurn.mockResolvedValue({ texto: 'Pronto.', toolsExecutadas: [], erro: null, triagemConcluida: null, esperadosDoAlvo: [{ marca: 'marca-nova' }] });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(setThirdPartyScope).not.toHaveBeenCalled();
          expect(marcarFalasComAlvoProcessado).toHaveBeenCalled();
        });
        test('a resposta à dúvida e "obrigado" no mesmo lote: a cobrança do turno continua limitada ao contrato identificado', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          listarFalasSemAlvoConfirmado.mockResolvedValueOnce([
            { id: 'm-0', direction: 'inbound', messageType: 'text', content: 'é a da Avenida de Teste', createdAt: new Date() },
            { id: 'm-1', direction: 'inbound', messageType: 'text', content: 'obrigado', createdAt: new Date() },
          ]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'obrigado' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false, contratoEscolhido: '302', contratosEscolhidos: ['302'] }));
        });
        test('a outra pessoa depois da dúvida (restringe): gravada ANTES do turno, como sempre', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é da minha mãe' });
          const ordem = ordemDoJob();
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(ordem).toEqual(['gravar', 'turno', 'marcar']);
        });

        test('gravar a dúvida de endereço falhou: o turno trava e as entradas não são marcadas (o próximo turno reaplica)', async () => {
          const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
          getThirdPartyScope.mockResolvedValue(null);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o pix da Avenida Central' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
          expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          errorSpy.mockRestore();
        });

        test('dúvida de endereço vencida: continua a mesma dúvida (não vira pedido de outra pessoa)', async () => {
          getThirdPartyScope.mockResolvedValue({ ...DUVIDA_GRAVADA, expiraEm: PASSADO });
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(setThirdPartyScope).not.toHaveBeenCalled();
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: DUVIDA_NO_TURNO, alvoAmbiguo: 'endereco_desconhecido' }));
        });

        test('dúvida de endereço vencida que muda ("é da minha mãe"): grava a nova dúvida sobre o escopo lido, sem erro', async () => {
          getThirdPartyScope.mockResolvedValue({ ...DUVIDA_GRAVADA, expiraEm: PASSADO });
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é da minha mãe' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          // A condição da gravação é a marca do escopo lido (vencido), não uma lista qualquer (achado A6 da revisão).
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' }),
            expect.objectContaining({ esperados: [{ marca: 'marca-duvida' }] }));
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'outra_pessoa_sem_documento' }));
        });

        test('duas falas com contratos diferentes: os dois chegam ao turno, nenhum forçado sozinho', async () => {
          getThirdPartyScope.mockResolvedValue(null);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          listarFalasSemAlvoConfirmado.mockResolvedValueOnce([
            { id: 'm-0', direction: 'inbound', messageType: 'text', content: 'manda o pix da Rua de Teste', createdAt: new Date() },
            { id: 'm-1', direction: 'inbound', messageType: 'text', content: 'e o da Avenida de Teste', createdAt: new Date() },
          ]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'e o da Avenida de Teste' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: false, contratoEscolhido: null, contratosEscolhidos: ['301', '302'] }));
        });

        test('"é a minha" com a dúvida gravada: conta também o contrato dele sem endereço (dois contratos: a dúvida passa a ser qual)', async () => {
          getThirdPartyScope.mockResolvedValue(DUVIDA_GRAVADA);
          resolverIdentidade.mockResolvedValue({ ...DOIS_CONTRATOS, contracts: [DOIS_CONTRATOS.contracts[0], { id: 309, address: '' }] });
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'é a minha fatura mesmo' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'endereco_ambiguo', contratoEscolhido: null }));
        });

        test('a entrada do job, fora da lista e sem texto (imagem), também desfaz a escolha de contrato', async () => {
          getThirdPartyScope.mockResolvedValue(null);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          listarFalasSemAlvoConfirmado.mockResolvedValueOnce([
            { id: 'm-0', direction: 'inbound', messageType: 'text', content: 'manda o pix da Avenida de Teste', createdAt: new Date() },
          ]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'image', content: null });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: false, contratoEscolhido: null }));
        });

        test('entrada sem texto depois do pedido pela rua (imagem): desfaz a escolha de contrato', async () => {
          getThirdPartyScope.mockResolvedValue(null);
          resolverIdentidade.mockResolvedValue(DOIS_CONTRATOS);
          listarFalasSemAlvoConfirmado.mockResolvedValueOnce([
            { id: 'm-0', direction: 'inbound', messageType: 'text', content: 'manda o pix da Avenida de Teste', createdAt: new Date() },
            { id: 'm-1', direction: 'inbound', messageType: 'image', content: null, createdAt: new Date() },
          ]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'image', content: null });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: false, contratoEscolhido: null }));
        });

        test('gravar a dúvida falhou: o turno segue travado e registra', async () => {
          const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'agora é de outra pessoa' });

          runAiTurn.mockResolvedValue({ texto: 'De quem é a cobrança?', toolsExecutadas: [], erro: null });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          // Segunda revisão: transição não gravada não pode parecer concluída — nenhuma cobrança. Terceira
          // revisão: a entrada fica sem a marca de processada, e o próximo turno a reaplica.
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
          expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          expect(enqueueOutboundMessage.mock.calls[0][0].metadata).toBeUndefined();
          expect(errorSpy).toHaveBeenCalled();
          errorSpy.mockRestore();
        });

        // Terceira revisão da F2 (30/09/2026): expiração encerra a autorização, não resolve a dúvida. O escopo
        // vencido com dúvida NÃO é limpo; o turno recebe a dúvida sem autorização (nenhum contrato).
        describe('escopo com a dúvida mas vencido', () => {
          const VENCIDO = { ...COM_DUVIDA, expiraEm: PASSADO };
          const SEM_AUTORIZACAO = { nome: null, contratos: [], pendente: true, alvoPendente: 'terceiro_expirado' };

          test('"pode mandar": não limpa, não autoriza contrato nenhum e trava a cobrança', async () => {
            getThirdPartyScope.mockResolvedValue(VENCIDO);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(setThirdPartyScope).not.toHaveBeenCalled();
            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
              terceiro: SEM_AUTORIZACAO, alvoAmbiguo: 'terceiro_expirado', terceiroLocalizadoEm: null,
            }));
            // Nada a gravar: a entrada foi aplicada ao estado persistido.
            expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-1']);
          });

          test('as falas pendentes são pedidas pelos últimos 30 minutos, não pela criação do escopo vencido', async () => {
            getThirdPartyScope.mockResolvedValue(VENCIDO);
            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
            const [, { desde }] = listarFalasSemAlvoConfirmado.mock.calls[0];
            expect(Math.abs(desde.getTime() - (Date.now() - 30 * 60 * 1000))).toBeLessThan(5000);
          });

          test('"quero a minha fatura": limpa o escopo vencido e segue o titular', async () => {
            getThirdPartyScope.mockResolvedValue(VENCIDO);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
          });

          test('a limpeza falhou: nenhuma cobrança, e a entrada fica sem a marca', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            getThirdPartyScope.mockResolvedValue(VENCIDO);
            setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
            expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            errorSpy.mockRestore();
          });

          // Decisão gerencial (30/09/2026): o documento de terceiro não localizado também não se resolve pelo prazo.
          describe('documento de terceiro não localizado (pendente, sem dúvida gravada) e vencido', () => {
            const NAO_LOCALIZADO_VENCIDO = { nome: null, contratos: [], pendente: true, expiraEm: PASSADO };

            test('"pode mandar": não limpa e trava a cobrança', async () => {
              getThirdPartyScope.mockResolvedValue(NAO_LOCALIZADO_VENCIDO);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).not.toHaveBeenCalled();
              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: SEM_AUTORIZACAO, alvoAmbiguo: 'terceiro_expirado' }));
            });

            test('a própria cobrança: limpa e segue o titular', async () => {
              getThirdPartyScope.mockResolvedValue(NAO_LOCALIZADO_VENCIDO);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
            });

            test('a limpeza falhou: nenhuma cobrança por suposição, e a entrada fica sem a marca', async () => {
              const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
              getThirdPartyScope.mockResolvedValue(NAO_LOCALIZADO_VENCIDO);
              setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
              errorSpy.mockRestore();
            });
          });

          test('vencido SEM dúvida: a regra de 25/09 continua — limpa e segue o titular', async () => {
            getThirdPartyScope.mockResolvedValue({ ...ESCOPO, expiraEm: PASSADO });
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
          });
        });
      });

      test('a limpeza falhou: segue no terceiro (o lado seguro) e registra', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        getThirdPartyScope.mockResolvedValue(ESCOPO);
        setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
        findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'agora o meu' });
        runAiTurn.mockResolvedValue({ texto: 'Não consegui seguir com a cobrança agora.', toolsExecutadas: [], erro: null });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        // Segunda revisão: manter a Beltrana sem trava cobraria a pessoa anterior logo depois de ele pedir a
        // própria cobrança. Nenhuma cobrança sai — nem dela, nem dele — e a entrada fica sem a marca.
        expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
        expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
        expect(enqueueOutboundMessage.mock.calls[0][0].metadata).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
      });

      // Segunda revisão da F2 (30/09/2026): o turno reaplica as falas ainda não confirmadas (registro durável:
      // mensagens no banco + resposta marcada quando a transição não foi gravada).
      describe('recuperação entre turnos', () => {
        const fala = (id, content) => ({ id, direction: 'inbound', messageType: 'text', content, createdAt: new Date() });
        afterEach(() => {
          listarFalasSemAlvoConfirmado.mockReset();
        });

        test('pede as falas desde a criação do escopo (ou 30 minutos), em páginas (segurança final, 03/10/2026)', async () => {
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          const [conversa, { desde, limite, depoisDe }] = listarFalasSemAlvoConfirmado.mock.calls[0];
          expect(conversa).toBe('c-1');
          expect(desde.getTime()).toBe(Date.parse(FUTURO) - 30 * 60 * 1000);
          expect(limite).toBe(200);
          expect(depoisDe).toBeNull();
        });

        test('mensagem seguinte depois de a dúvida não ter sido gravada: a fala volta e a dúvida é gravada', async () => {
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-0', 'manda o boleto da minha mãe'), fala('m-1', 'pode mandar')]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          // Rodada 8 (N1): a origem da dúvida é a entrada cuja gravação tinha falhado (m-0), reaplicada agora.
          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', comMarca({ ...ESCOPO, alvoPendente: 'terceiro_nao_vinculado', duvidaDesde: 'm-0' }), GRAVACAO_CONDICIONAL);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'terceiro_nao_vinculado' }));
        });

        test('mensagem seguinte depois de a volta ao próprio não ter sido gravada: a volta se conclui', async () => {
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-0', 'quero a minha fatura'), fala('m-1', 'manda o boleto')]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
        });

        test('falhou de novo na mensagem seguinte: continua travado e marcado', async () => {
          const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
          listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-0', 'quero a minha fatura')]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto' });
          runAiTurn.mockResolvedValue({ texto: 'Não consegui seguir agora.', toolsExecutadas: [], erro: null });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
          expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          expect(enqueueOutboundMessage.mock.calls[0][0].metadata).toBeUndefined();
          errorSpy.mockRestore();
        });

        test('reinício do processamento: sem nada em memória, o escopo e as falas não confirmadas dão o mesmo estado', async () => {
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-0', 'não é da Beltrana'), fala('m-1', 'ok')]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'ok' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(runAiTurn.mock.calls.map(([a]) => a.alvoAmbiguo)).toEqual(['terceiro_nao_vinculado', 'terceiro_nao_vinculado']);
        });

        test('as falas não puderam ser lidas: nenhuma cobrança, nada gravado, resposta marcada', async () => {
          const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          listarFalasSemAlvoConfirmado.mockRejectedValueOnce(new Error('banco fora'));
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });
          runAiTurn.mockResolvedValue({ texto: 'Não consegui seguir agora.', toolsExecutadas: [], erro: null });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(setThirdPartyScope).not.toHaveBeenCalled();
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'escopo_nao_lido' }));
          expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          expect(enqueueOutboundMessage.mock.calls[0][0].metadata).toBeUndefined();
          errorSpy.mockRestore();
        });

        // MUDANÇA DELIBERADA (segurança final, 03/10/2026): mais de 50 falas não confirmadas travavam a cobrança até o
        // fim da triagem (nada era marcado nunca). Agora todas são lidas, em páginas, reaplicadas e marcadas.
        test('mais de uma página de falas sem confirmação: todas são lidas (cursor), nenhuma é descartada, e são marcadas', async () => {
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          const primeira = Array.from({ length: 200 }, (_, i) => ({ ...fala(`m-${i}`, 'ok'), createdAt: new Date(1000 + i) }));
          const segunda = [fala('m-200', 'ok'), fala('m-201', 'manda o boleto da minha mãe')];
          listarFalasSemAlvoConfirmado.mockResolvedValueOnce(primeira).mockResolvedValueOnce(segunda);
          findMessageById.mockResolvedValue({ id: 'm-201', messageType: 'text', content: 'manda o boleto da minha mãe' });
          findLatestInboundMessageId.mockResolvedValue('m-201');

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-201' });

          expect(listarFalasSemAlvoConfirmado).toHaveBeenCalledTimes(2);
          expect(listarFalasSemAlvoConfirmado.mock.calls[1][1].depoisDe).toEqual({ createdAt: primeira[199].createdAt, id: 'm-199' });
          // A fala da página 2 contou: a dúvida dela é gravada (nada foi descartado).
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'terceiro_nao_vinculado' }));
          expect(marcarFalasComAlvoProcessado.mock.calls[0][0]).toHaveLength(202);
          findLatestInboundMessageId.mockResolvedValue('m-1');
        });

        test('acima do teto patológico (10.000 falas sem confirmação): nenhuma cobrança, nada gravado nem marcado', async () => {
          const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          let n = 0;
          listarFalasSemAlvoConfirmado.mockImplementation(async () => Array.from({ length: 200 }, () => { n += 1; return { ...fala(`m-${n}`, 'ok'), createdAt: new Date(n) }; }));
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'ok' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(listarFalasSemAlvoConfirmado).toHaveBeenCalledTimes(50);
          expect(setThirdPartyScope).not.toHaveBeenCalled();
          expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'escopo_nao_lido' }));
          listarFalasSemAlvoConfirmado.mockReset();
          listarFalasSemAlvoConfirmado.mockResolvedValue([]);
          errorSpy.mockRestore();
        });

        test('resposta automática do WhatsApp do cliente não entra na reaplicação', async () => {
          getThirdPartyScope.mockResolvedValue(ESCOPO);
          listarFalasSemAlvoConfirmado.mockResolvedValue([
            { ...fala('m-0', 'fale com a minha mãe no outro número'), metadata: { autorrespostaProvavel: true } }, fala('m-1', 'pode mandar'),
          ]);
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: false }));
        });

        // Terceira revisão da F2 (30/09/2026): a confirmação é explícita, pelo id de cada entrada aplicada, depois
        // da transição persistida (ou de nenhuma ser necessária) e antes do turno. Saída não confirma entrada.
        describe('marca das entradas processadas', () => {
          // Falha de gravação dentro da consulta (30/09/2026): a marca vem DEPOIS do turno — a ferramenta também pode
          // ter uma transição a gravar, e a entrada só conta como concluída quando tudo do turno está gravado.
          test('transição gravada: marca as lidas e a do turno, depois de gravar e depois do turno', async () => {
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-0', 'manda o boleto da minha mãe'), fala('m-1', 'pode mandar')]);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(marcarFalasComAlvoProcessado).toHaveBeenCalledTimes(1);
            expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-0', 'm-1']);
            const ordem = (fn) => fn.mock.invocationCallOrder[0];
            expect(ordem(setThirdPartyScope)).toBeLessThan(ordem(runAiTurn));
            expect(ordem(runAiTurn)).toBeLessThan(ordem(marcarFalasComAlvoProcessado));
          });

          // Persistência do alvo (03/10/2026): gravações condicionais ao estado conhecido, estado que mudou depois da
          // leitura, documento em entrada anterior não confirmada e volta pelo próprio documento não gravada.
          describe('persistência do alvo: gravação condicional (03/10/2026)', () => {
            const COM_MARCA = { ...ESCOPO, marca: 'marca-lida' };
            const silenciar = () => jest.spyOn(console, 'error').mockImplementation(() => {});
            const ordem = (fn) => fn.mock.invocationCallOrder[0];

            test('a transição exige o estado lido; o turno recebe o estado gravado como esperado', async () => {
              getThirdPartyScope.mockResolvedValue(COM_MARCA);
              listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-1', 'quero a minha fatura')]);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, { esperados: [{ marca: 'marca-lida' }], aceitaNulo: true });
              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false, esperadosDoAlvo: [{ nulo: true }] }));
            });

            test('outro processamento gravou depois da leitura: a cobrança do turno trava e nada é marcado', async () => {
              const errorSpy = silenciar();
              getThirdPartyScope.mockResolvedValue(COM_MARCA);
              setThirdPartyScope.mockResolvedValue(false);
              listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-1', 'quero a minha fatura')]);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
              errorSpy.mockRestore();

              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            });

            test('escopo vencido trocado por outro processamento antes da limpeza: a cobrança trava e nada é marcado', async () => {
              const errorSpy = silenciar();
              getThirdPartyScope.mockResolvedValue({ ...COM_MARCA, expiraEm: PASSADO });
              setThirdPartyScope.mockResolvedValue(false);
              listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-1', 'manda o boleto')]);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
              errorSpy.mockRestore();

              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'transicao_nao_gravada' }));
              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            });

            test('entrada ANTERIOR não confirmada com o CPF de outra pessoa: o pendente sem contrato é gravado antes do turno', async () => {
              findContactById.mockResolvedValue({ id: 'ct-1', phoneNumber: '55989', sgpDocument: '52998224725' });
              getThirdPartyScope.mockResolvedValue(null);
              listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-0', '390.533.447-05'), fala('m-1', 'pode mandar')]);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ nome: null, contratos: [], pendente: true, marca: expect.any(String) }),
                { esperados: [{ nulo: true }], aceitaNulo: false });
              expect(ordem(setThirdPartyScope)).toBeLessThan(ordem(runAiTurn));
              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: { nome: null, contratos: [], pendente: true } }));
              expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-0', 'm-1']);
            });

            test('entrada sem texto antes do CPF de outra pessoa: o documento continua na entrada dele (o pendente é gravado)', async () => {
              findContactById.mockResolvedValue({ id: 'ct-1', phoneNumber: '55989', sgpDocument: '52998224725' });
              getThirdPartyScope.mockResolvedValue(null);
              listarFalasSemAlvoConfirmado.mockResolvedValue([
                { id: 'm-a', direction: 'inbound', messageType: 'image', content: null, createdAt: new Date() },
                fala('m-x', 'a minha fatura'), fala('m-0', '390.533.447-05'), fala('m-1', 'pode mandar'),
              ]);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ nome: null, contratos: [], pendente: true, marca: expect.any(String) }),
                { esperados: [{ nulo: true }], aceitaNulo: false });
              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: { nome: null, contratos: [], pendente: true } }));
            });

            test('o CPF de outra pessoa na PRÓPRIA entrada do job não muda o alvo antes do turno (quem consulta é o modelo)', async () => {
              findContactById.mockResolvedValue({ id: 'ct-1', phoneNumber: '55989', sgpDocument: '52998224725' });
              getThirdPartyScope.mockResolvedValue(null);
              listarFalasSemAlvoConfirmado.mockResolvedValue([fala('m-1', '390.533.447-05')]);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '390.533.447-05' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).not.toHaveBeenCalled();
              expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
            });

            test('a recuperação do pendente exige os estados que o turno devolveu (inclusive a gravação que lançou erro)', async () => {
              getThirdPartyScope.mockResolvedValue(null);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '39053344705' });
              runAiTurn.mockResolvedValueOnce({ texto: 'Não consegui concluir a consulta agora.', toolsExecutadas: [], erro: null, alvoTerceiroNaoGravado: true, esperadosDoAlvo: [{ nulo: true }, { marca: 'tentada' }] });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ pendente: true }), { esperados: [{ nulo: true }, { marca: 'tentada' }] });
              expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-1']);
            });

            test('a recuperação do pendente encontra outro estado: as entradas não são marcadas', async () => {
              const errorSpy = silenciar();
              getThirdPartyScope.mockResolvedValue(null);
              setThirdPartyScope.mockResolvedValue(false);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '39053344705' });
              runAiTurn.mockResolvedValueOnce({ texto: 'Não consegui concluir a consulta agora.', toolsExecutadas: [], erro: null, alvoTerceiroNaoGravado: true, esperadosDoAlvo: [{ nulo: true }] });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
              errorSpy.mockRestore();

              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            });

            test('achado 3a: a identificação pelo próprio documento não terminou (SGP ou tempo): nada é gravado e as entradas não são marcadas', async () => {
              getThirdPartyScope.mockResolvedValue(COM_MARCA);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '52998224725' });
              runAiTurn.mockResolvedValueOnce({ texto: 'Não consegui consultar agora.', toolsExecutadas: [], erro: null, consultaPropriaPendente: true, esperadosDoAlvo: [{ marca: 'marca-lida' }] });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).not.toHaveBeenCalled();
              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            });

            test('segurança final: a reserva de uma entrega encontrou o alvo mudado: as entradas não são marcadas', async () => {
              getThirdPartyScope.mockResolvedValue(COM_MARCA);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });
              runAiTurn.mockResolvedValueOnce({ texto: 'Não consegui enviar agora.', toolsExecutadas: [], erro: null, alvoMudouNaEntrega: true, esperadosDoAlvo: [{ marca: 'marca-lida' }] });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            });

            describe('volta ao titular pelo próprio documento não gravada (bloqueador 2)', () => {
              const voltaNaoGravada = (esperadosDoAlvo) => runAiTurn.mockResolvedValueOnce({
                texto: 'Pronto.', toolsExecutadas: [], erro: null, voltaAoTitularNaoGravada: true, esperadosDoAlvo,
              });

              test('o worker grava a volta depois do turno, com os estados que o turno conhece, e só então marca', async () => {
                getThirdPartyScope.mockResolvedValue(COM_MARCA);
                findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '52998224725' });
                voltaNaoGravada([{ marca: 'marca-lida' }, { nulo: true }]);

                await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

                expect(setThirdPartyScope).toHaveBeenCalledTimes(1);
                expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, { esperados: [{ marca: 'marca-lida' }, { nulo: true }], aceitaNulo: true });
                expect(ordem(runAiTurn)).toBeLessThan(ordem(setThirdPartyScope));
                expect(ordem(setThirdPartyScope)).toBeLessThan(ordem(marcarFalasComAlvoProcessado));
                expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-1']);
              });

              test('outro processamento gravou: a volta não é escrita e as entradas não são marcadas', async () => {
                const errorSpy = silenciar();
                getThirdPartyScope.mockResolvedValue(COM_MARCA);
                setThirdPartyScope.mockResolvedValue(false);
                findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '52998224725' });
                voltaNaoGravada([{ marca: 'marca-lida' }]);

                await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
                errorSpy.mockRestore();

                expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
              });

              test('a gravação da volta lança erro: as entradas não são marcadas', async () => {
                const errorSpy = silenciar();
                getThirdPartyScope.mockResolvedValue(COM_MARCA);
                setThirdPartyScope.mockRejectedValue(new Error('banco fora'));
                findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '52998224725' });
                voltaNaoGravada([{ marca: 'marca-lida' }]);

                await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
                errorSpy.mockRestore();

                expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
              });
            });
          });

          describe('consulta de terceiro que não gravou o pendente (aviso da ferramenta)', () => {
            const PENDENTE = expect.objectContaining({ nome: null, contratos: [], pendente: true });

            test('o worker grava o pendente depois do turno e só então marca as entradas', async () => {
              getThirdPartyScope.mockResolvedValue(null);
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '39053344705' });
              runAiTurn.mockResolvedValueOnce({ texto: 'Não consegui concluir a consulta agora.', toolsExecutadas: [], erro: null, alvoTerceiroNaoGravado: true });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).toHaveBeenCalledTimes(1);
              expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', PENDENTE, GRAVACAO_CONDICIONAL);
              const ordem = (fn) => fn.mock.invocationCallOrder[0];
              expect(ordem(runAiTurn)).toBeLessThan(ordem(setThirdPartyScope));
              expect(ordem(setThirdPartyScope)).toBeLessThan(ordem(marcarFalasComAlvoProcessado));
              expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-1']);
            });

            test('a gravação do worker também falhou: as entradas do turno NÃO são marcadas como concluídas', async () => {
              const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
              getThirdPartyScope.mockResolvedValue({ ...ESCOPO });
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: '39053344705' });
              runAiTurn.mockResolvedValueOnce({ texto: 'Não consegui concluir a consulta agora.', toolsExecutadas: [], erro: null, alvoTerceiroNaoGravado: true });
              setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', PENDENTE, GRAVACAO_CONDICIONAL);
              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
              expect(errorSpy).toHaveBeenCalled();
              errorSpy.mockRestore();
            });

            test('sem o aviso, o worker não grava nada depois do turno', async () => {
              getThirdPartyScope.mockResolvedValue({ ...ESCOPO });
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

              expect(setThirdPartyScope).not.toHaveBeenCalled();
              expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-1']);
            });

            test('o turno lançou erro: nenhuma entrada é marcada', async () => {
              const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
              getThirdPartyScope.mockResolvedValue({ ...ESCOPO });
              findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });
              runAiTurn.mockRejectedValueOnce(new Error('turno caiu'));

              await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' }).catch(() => {});

              expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
              errorSpy.mockRestore();
            });
          });

          test('nenhuma transição necessária: marca a entrada do turno', async () => {
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(setThirdPartyScope).not.toHaveBeenCalled();
            expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-1']);
          });

          test('entrada que chega durante o turno (depois da leitura) não é marcada e é aplicada no turno seguinte', async () => {
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            listarFalasSemAlvoConfirmado.mockResolvedValueOnce([fala('m-1', 'pode mandar')]);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });
            // Durante o turno chega "quero a minha fatura" (m-2): a resposta deste turno é descartada.
            runAiTurn.mockImplementationOnce(async () => {
              findLatestInboundMessageId.mockResolvedValue('m-2');
              return { texto: 'Enviei o boleto.', toolsExecutadas: [], erro: null };
            });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(enqueueOutboundMessage).not.toHaveBeenCalled();
            // A marca vem logo depois do turno, antes de descartar a resposta: o que o turno aplicou está gravado.
            expect(marcarFalasComAlvoProcessado.mock.calls).toEqual([[['m-1']]]);

            listarFalasSemAlvoConfirmado.mockResolvedValueOnce([fala('m-2', 'quero a minha fatura')]);
            findMessageById.mockResolvedValue({ id: 'm-2', messageType: 'text', content: 'quero a minha fatura' });
            await handleAiJob({ conversationId: 'c-1', messageId: 'm-2' });

            expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', null, VOLTA_CONDICIONAL);
            expect(marcarFalasComAlvoProcessado).toHaveBeenLastCalledWith(['m-2']);
            findLatestInboundMessageId.mockResolvedValue('m-1');
          });

          test('entrada mais nova que a do job já lida: a reaplicação segue a ordem do banco, não põe a do job por último', async () => {
            // m-2 chegou depois da checagem "é a mais recente?" e antes da leitura das pendentes.
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            listarFalasSemAlvoConfirmado.mockResolvedValueOnce([fala('m-1', 'quero a minha fatura'), fala('m-2', 'manda o boleto da minha mãe')]);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'quero a minha fatura' });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            // Própria cobrança e, DEPOIS, outra pessoa sem documento: o titular não pode ficar liberado.
            expect(setThirdPartyScope).toHaveBeenCalledWith('c-1', expect.objectContaining({ contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento', marca: expect.any(String) }), GRAVACAO_CONDICIONAL);
            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'outra_pessoa_sem_documento' }));
            expect(marcarFalasComAlvoProcessado).toHaveBeenCalledWith(['m-1', 'm-2']);
          });

          test('turno com ferramenta e cartão enviado: uma marca só, depois do turno, e só entradas são marcadas', async () => {
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'pode mandar' });
            runAiTurn.mockResolvedValueOnce({ texto: 'Pronto, enviei o PIX.', toolsExecutadas: [{ nome: 'gerar_pix' }], erro: null });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(marcarFalasComAlvoProcessado.mock.calls).toEqual([[['m-1']]]);
            expect(runAiTurn.mock.invocationCallOrder[0]).toBeLessThan(marcarFalasComAlvoProcessado.mock.invocationCallOrder[0]);
          });

          test('reprocessamento de uma entrada já marcada: não é reaplicada sobre o estado que ela mesma gerou', async () => {
            // O turno marcou "o boleto da minha mãe" e, depois, o documento consultado gravou o escopo da Beltrana;
            // o processo caiu antes da resposta. O mesmo job de novo não pode travar a Beltrana por essa fala.
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto da minha mãe', metadata: { alvoProcessado: true } });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(setThirdPartyScope).not.toHaveBeenCalled();
            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: { nome: 'Beltrana', contratos: [{ id: 77 }] }, alvoAmbiguo: false }));
            expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
          });

          test('reprocessamento de uma entrada já marcada com a dúvida gravada: a dúvida continua valendo', async () => {
            getThirdPartyScope.mockResolvedValue({ ...ESCOPO, alvoPendente: 'terceiro_nao_vinculado' });
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto da minha mãe', metadata: { alvoProcessado: true } });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'terceiro_nao_vinculado' }));
            expect(setThirdPartyScope).not.toHaveBeenCalled();
          });

          test('áudio sem transcrição e nada pendente, com a dúvida gravada: a dúvida continua valendo', async () => {
            getThirdPartyScope.mockResolvedValue({ ...ESCOPO, alvoPendente: 'terceiro_nao_vinculado' });
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'audio', content: null, transcription: null });

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'terceiro_nao_vinculado' }));
          });

          test('a marca falhou: só registra; o turno segue com o estado gravado', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto da minha mãe' });
            marcarFalasComAlvoProcessado.mockRejectedValueOnce(new Error('banco fora'));

            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ alvoAmbiguo: 'terceiro_nao_vinculado' }));
            expect(enqueueOutboundMessage).toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalled();
            errorSpy.mockRestore();
          });

          test('falas não lidas ou acima do limite: nada é marcado', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            getThirdPartyScope.mockResolvedValue(ESCOPO);
            listarFalasSemAlvoConfirmado.mockRejectedValueOnce(new Error('banco fora'));
            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
            getThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
            await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

            expect(runAiTurn.mock.calls.map(([a]) => a.alvoAmbiguo)).toEqual(['escopo_nao_lido', 'escopo_nao_lido']);
            expect(marcarFalasComAlvoProcessado).not.toHaveBeenCalled();
            errorSpy.mockRestore();
          });
        });

        test('o nome da empresa, lido da configuração, não é referência de outra pessoa', async () => {
          getThirdPartyScope.mockResolvedValue(null);
          getCompanyConfig.mockResolvedValueOnce({ name: 'DW Telecom' });
          findMessageById.mockResolvedValue({ id: 'm-1', messageType: 'text', content: 'manda o boleto da dw' });

          await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

          expect(setThirdPartyScope).not.toHaveBeenCalled();
          expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({ terceiro: null, alvoAmbiguo: false }));
        });
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
        resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Joaquim', contracts: [] });
      });

      test('sem texto mas com liberação feita: o código manda a frase do dono e conclui na fila', async () => {
        runAiTurn.mockResolvedValue({ texto: null, toolsExecutadas: [], erro: 'turn_timeout', triagemConcluida: null, desbloqueioRealizado: true });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledWith({
          conversationId: 'c-1', channelId: 'ch-1', sentBy: 'ai',
          content: 'Prontinho, Joaquim! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das 08:00. Já deixei seu atendimento na fila para acompanhamento. Você consegue testar se a internet voltou?',
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
        runAiTurn.mockResolvedValue({ texto: 'Prontinho, Joaquim! Testa a internet aí.', toolsExecutadas: [], erro: null, triagemConcluida: null, desbloqueioRealizado: true });

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

    // Fechamento limitado (04/10/2026; avaliação real r4 E11 #5): o desbloqueio foi confirmado e a conclusão da triagem veio
    // no mesmo turno; a instrução da conclusão prevaleceu e a mensagem final não disse que a internet foi liberada. Agora a
    // mensagem sai pelos fatos do turno: a liberação confirmada nele e a fila relida depois dele. Sem nova liberação, sem
    // nova conclusão; atendente, encerramento ou silenciamento durante o turno continuam em silêncio.
    describe('desbloqueio confirmado e conclusão da triagem no mesmo turno', () => {
      const NOTURNO = { mode: 'assistant', apiKey: 'k', model: 'm', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3, transcriptionFeedAi: true, nightStartTime: '20:00', nightEndTime: '08:00' };
      const OMITIU = 'Prontinho, Beltrano! O atendimento ficou registrado para o Financeiro e nossa equipe dá continuidade a partir das 08:00.';
      const CONCLUIU_NO_TURNO = {
        texto: OMITIU, toolsExecutadas: [{ nome: 'desbloqueio_confianca' }, { nome: 'concluir_triagem' }], erro: null,
        triagemConcluida: { setor: 'Financeiro' }, desbloqueioRealizado: true, desbloqueioNoTurno: true,
      };
      const FRASE = 'Prontinho, Beltrano! O desbloqueio em confiança foi realizado. Seu atendimento ficou registrado para o setor Financeiro e nossa equipe dá continuidade a partir das 08:00.';

      beforeEach(() => {
        isNightModeActive.mockReturnValue(true);
        getAiConfig.mockResolvedValue(NOTURNO);
        resolverIdentidade.mockResolvedValue({ nivel: 'forte', origem: 'phone', primeiroNome: 'Beltrano', contracts: [] });
      });

      test('reprodução — a mensagem final informa a liberação confirmada e a fila efetiva; o texto que a omitia não sai', async () => {
        runAiTurn.mockResolvedValue(CONCLUIU_NO_TURNO);
        getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, triageState: 'completed' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
        const [{ content }] = enqueueOutboundMessage.mock.calls[0];
        expect(content.endsWith(FRASE)).toBe(true);
        expect(runAiTurn).toHaveBeenCalledTimes(1);
        expect(concludeAiTriage).not.toHaveBeenCalled();
        expect(incrementTriageAttempts).not.toHaveBeenCalled();
      });

      test.each([
        ['um atendente assumiu', { status: 'assigned', assignedAgentId: 'a-1' }],
        ['a conversa foi encerrada por fora', { status: 'closed' }],
        ['a conversa foi silenciada', { status: 'silent' }],
      ])('%s durante o turno: silêncio', async (_nome, estado) => {
        runAiTurn.mockResolvedValue(CONCLUIU_NO_TURNO);
        getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, triageState: 'completed', ...estado });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).not.toHaveBeenCalled();
        expect(concludeAiTriage).not.toHaveBeenCalled();
      });

      test('a mensagem composta pelos fatos não leva a marca da oferta do boleto calculada sobre o texto do modelo', async () => {
        runAiTurn.mockResolvedValue({ ...CONCLUIU_NO_TURNO, ofertaDoBoleto: { faturaId: '9' } });
        getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, triageState: 'completed' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
        expect(enqueueOutboundMessage.mock.calls[0][0].content.endsWith(FRASE)).toBe(true);
        expect(enqueueOutboundMessage.mock.calls[0][0]).not.toHaveProperty('metadata');
      });

      test('liberação de um turno anterior (não deste): o texto do modelo segue como está', async () => {
        runAiTurn.mockResolvedValue({ ...CONCLUIU_NO_TURNO, desbloqueioNoTurno: false });
        getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, triageState: 'completed' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
        expect(enqueueOutboundMessage.mock.calls[0][0].content).toMatch(/O atendimento ficou registrado para o Financeiro/);
        expect(enqueueOutboundMessage.mock.calls[0][0].content).not.toMatch(/desbloqueio em confiança foi realizado/);
      });

      test('liberação confirmada sem conclusão neste turno: a composição não entra (quem fala é o turno, com as guardas de sempre)', async () => {
        runAiTurn.mockResolvedValue({ ...CONCLUIU_NO_TURNO, texto: 'Prontinho, Beltrano! O desbloqueio em confiança foi realizado.', triagemConcluida: null });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
        expect(enqueueOutboundMessage.mock.calls[0][0].content).not.toMatch(/ficou registrado para o setor/);
      });

      test('de dia (sem o modo noturno), nada muda: o texto do turno segue', async () => {
        isNightModeActive.mockReturnValue(false);
        runAiTurn.mockResolvedValue(CONCLUIU_NO_TURNO);
        getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, triageState: 'completed' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
        expect(enqueueOutboundMessage.mock.calls[0][0].content).toMatch(/O atendimento ficou registrado para o Financeiro/);
      });

      test('o próprio turno encerrou o atendimento: a despedida do turno segue', async () => {
        runAiTurn.mockResolvedValue({ ...CONCLUIU_NO_TURNO, texto: 'Imagina! Qualquer dúvida, é só chamar.', atendimentoEncerrado: true });
        getConversationWithContact.mockResolvedValueOnce(PENDING).mockResolvedValueOnce({ ...PENDING, status: 'closed', triageState: 'completed' });

        await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });

        expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
        expect(enqueueOutboundMessage.mock.calls[0][0].content).toMatch(/Qualquer dúvida, é só chamar/);
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
