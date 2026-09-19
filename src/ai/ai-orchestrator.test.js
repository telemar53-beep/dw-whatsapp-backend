jest.mock('./openai-client');
jest.mock('./tool-executor');
jest.mock('./ai-config.repository');
jest.mock('./ai-interaction.repository');
jest.mock('../conversations/message.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../sectors/sector.repository');
jest.mock('../integrations/sgp-client');
jest.mock('./trust-unlock.repository');
jest.mock('../company/company-config.repository');

const { createChatCompletion } = require('./openai-client');
const { executeTool } = require('./tool-executor');
const { getAiConfig, listToolPermissions } = require('./ai-config.repository');
const { recordAiInteraction } = require('./ai-interaction.repository');
const { listRecentMessagesByConversation } = require('../conversations/message.repository');
const { listActiveReasons } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const sgpClient = require('../integrations/sgp-client');
const { hasRecentTrustUnlockByContact } = require('./trust-unlock.repository');
const { getCompanyConfig } = require('../company/company-config.repository');
const {
  runAiTurn, FERRAMENTAS_TRIAGEM, FERRAMENTAS_TRIAGEM_NOTURNO, FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA,
} = require('./ai-orchestrator');

const CONVERSATION = { id: 'c-1', channelId: 'ch-1' };
const CONTACT = { id: 'ct-1', sgpClientId: null, sgpContractId: null, sgpDocument: null };

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue({
    apiKey: 'sk', model: 'gpt-x', mode: 'assistant',
    systemPrompt: 'Você é a assistente do provedor.', maxToolsPerInteraction: 8,
  });
  listToolPermissions.mockResolvedValue([{ toolName: 'consultar_plano', enabled: true }]);
  listRecentMessagesByConversation.mockResolvedValue([
    { direction: 'inbound', content: 'qual meu plano?', messageType: 'text' },
  ]);
  listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Lentidão' }]);
  listSectors.mockResolvedValue([{ id: 's-1', name: 'Suporte' }]);
  recordAiInteraction.mockResolvedValue({ id: 'i-1' });
  // Padrão: nenhuma liberação em confiança recente para o contato.
  hasRecentTrustUnlockByContact.mockResolvedValue(false);
  getCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: [] });
});

describe('ai-orchestrator', () => {
  test('returns the assistant text when the model asks for no tools', async () => {
    createChatCompletion.mockResolvedValue({
      message: { role: 'assistant', content: 'Bom dia! Como posso ajudar?' },
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(result.texto).toBe('Bom dia! Como posso ajudar?');
    expect(executeTool).not.toHaveBeenCalled();
  });

  // Finding 1 (fix round 1): sem tool_calls e sem content utilizável (ex.: um
  // corte por content_filter, ou um turno vazio), o laço não pode terminar em
  // silêncio — nem para quem chama runAiTurn, nem para a auditoria.
  test('records an error instead of finishing silently when the model returns no tool calls and no text', async () => {
    createChatCompletion.mockResolvedValue({
      message: { role: 'assistant', content: null },
      usage: { promptTokens: 8, completionTokens: 0 },
    });

    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(result.texto).toBeNull();
    expect(result.erro).toBeTruthy();
    expect(recordAiInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c-1', error: expect.any(String), finalResponse: null })
    );
  });

  test('sends only enabled tools to the model', async () => {
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    const nomes = createChatCompletion.mock.calls[0][0].tools.map((t) => t.function.name);
    expect(nomes).toEqual(['consultar_plano']);
  });

  // Teste real 2026-09-15 (produção, gpt-5.4-mini): "Boa noite, Willemberg!
  // كيف posso ajudar você hoje?" — palavra em árabe no meio da saudação, e não
  // foi a primeira vez. O prompt-base já pede português; a garantia é em
  // código: uma reescrita sem ferramentas e, se ainda vier estranho, o corte.
  describe('resposta com letras de outro alfabeto', () => {
    const INSTRUCAO = 'Sua resposta contém palavras ou letras de outro idioma/alfabeto. Reescreva a MESMA resposta, com o mesmo sentido, inteiramente em português do Brasil, sem nenhuma palavra de outro idioma.';

    test('pede uma reescrita sem ferramentas e devolve o texto reescrito', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Boa noite, Willemberg! كيف posso ajudar você hoje?' }, usage: { promptTokens: 10, completionTokens: 5 } })
        .mockResolvedValueOnce({ message: { content: 'Boa noite, Willemberg! Como posso ajudar você hoje?' }, usage: { promptTokens: 12, completionTokens: 6 } });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

      expect(r.texto).toBe('Boa noite, Willemberg! Como posso ajudar você hoje?');
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      const segunda = createChatCompletion.mock.calls[1][0];
      expect(segunda.tools).toEqual([]);
      expect(segunda.messages.slice(-2)).toEqual([
        { role: 'assistant', content: 'Boa noite, Willemberg! كيف posso ajudar você hoje?' },
        { role: 'system', content: INSTRUCAO },
      ]);
      // A auditoria guarda o que o cliente recebe e soma os tokens da reescrita.
      expect(recordAiInteraction).toHaveBeenCalledWith(expect.objectContaining({
        finalResponse: 'Boa noite, Willemberg! Como posso ajudar você hoje?', promptTokens: 22, completionTokens: 11, error: null,
      }));
    });

    test('reescrita ainda estranha (ou vazia): corta as palavras estranhas e segue', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Boa noite, Willemberg! كيف posso ajudar você hoje?' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Boa noite, Willemberg! كيف posso ajudar?' }, usage: {} });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

      expect(r.texto).toBe('Boa noite, Willemberg! posso ajudar você hoje?');
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(r.erro).toBeNull();
    });

    test('falha na chamada de reescrita não derruba o turno: corta e segue', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Olá! Привет, tudo bem?' }, usage: {} })
        .mockRejectedValueOnce(new Error('openai_timeout'));
      const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
        expect(r.texto).toBe('Olá!, tudo bem?');
        expect(r.erro).toBeNull();
      } finally {
        erroSpy.mockRestore();
      }
    });

    test('texto só em português não gera chamada extra', async () => {
      createChatCompletion.mockResolvedValue({ message: { content: 'Boa noite, Willemberg! 😊 Como posso ajudar você hoje?' }, usage: {} });
      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
      expect(r.texto).toBe('Boa noite, Willemberg! 😊 Como posso ajudar você hoje?');
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });
  });

  describe('contratos no contexto do sistema', () => {
    const IDENTIFICADO = { id: 'ct-1', sgpClientId: 10, sgpContractId: null, sgpDocument: '52998224725' };
    const CONTRATO_A = {
      id: 17402, status: 'Ativo', statusCode: 1, plan: '600MB', internetPlan: 'FIBRA 600',
      login: 'cliente-dw', address: 'RUA X, 523 - CENTRO', servico_senha: 'SEGREDO-PPPOE',
    };
    const CONTRATO_B = {
      id: 17405, status: 'Ativo', statusCode: 1, plan: '300MB', internetPlan: 'FIBRA 300',
      login: 'cliente-dw2', address: 'AV Y, 10 - BAIRRO Z', servico_senha: 'OUTRO-SEGREDO',
    };

    async function contextoDoSistema() {
      createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });
      await runAiTurn({ conversation: CONVERSATION, contact: IDENTIFICADO });
      return createChatCompletion.mock.calls[0][0].messages[0].content;
    }

    test('com mais de um contrato, lista cada um pelo endereço e proíbe pedir o número', async () => {
      // O cliente não sabe o número do contrato dele. Antes, o contexto mandava
      // "peça para ele escolher" sem listar nada — a IA perguntava "qual
      // contrato?" e a conversa travava.
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [CONTRATO_A, CONTRATO_B] });
      const contexto = await contextoDoSistema();
      expect(contexto).toContain('17402');
      expect(contexto).toContain('RUA X, 523 - CENTRO');
      expect(contexto).toContain('17405');
      expect(contexto).toContain('AV Y, 10 - BAIRRO Z');
      expect(contexto).toMatch(/nunca peça o número do contrato/i);
      expect(contexto).toMatch(/sem perguntar qual é/i);
    });

    test('instrui o desbloqueio em confiança só quando a ferramenta está ligada', async () => {
      listToolPermissions.mockResolvedValue([{ toolName: 'desbloqueio_confianca', enabled: true }]);
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [CONTRATO_A] });
      const contexto = await contextoDoSistema();
      expect(contexto).toContain('desbloqueio_confianca');
      expect(contexto).toMatch(/"suspenso"/);
      expect(contexto).toMatch(/nunca prometa prazo/i);
      expect(contexto).toMatch(/indeterminado/i);
    });

    test('com a ferramenta de desbloqueio desligada, o contexto não a menciona', async () => {
      // Descrever uma capacidade ausente leva o modelo a afirmar que fez.
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [CONTRATO_A] });
      const contexto = await contextoDoSistema();
      expect(contexto).not.toContain('desbloqueio');
    });

    test('a instrução de faturas segue a ferramenta disponível', async () => {
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [CONTRATO_A, CONTRATO_B] });
      let contexto = await contextoDoSistema();
      expect(contexto).not.toContain('consultar_faturas_todos_contratos');
      expect(contexto).toMatch(/contrato a contrato/);

      jest.clearAllMocks();
      listToolPermissions.mockResolvedValue([{ toolName: 'consultar_faturas_todos_contratos', enabled: true }]);
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [CONTRATO_A, CONTRATO_B] });
      contexto = await contextoDoSistema();
      expect(contexto).toContain('consultar_faturas_todos_contratos');
    });

    test('com um contrato só, diz para usá-lo sem perguntar', async () => {
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [CONTRATO_A] });
      const contexto = await contextoDoSistema();
      expect(contexto).toContain('17402');
      expect(contexto).toMatch(/sem perguntar/i);
      expect(contexto).not.toMatch(/nunca peça o número/i);
    });

    test('a listagem passa pelo normalizador: senha PPPoE e login nunca entram no contexto', async () => {
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [CONTRATO_A, CONTRATO_B] });
      const contexto = await contextoDoSistema();
      expect(contexto).not.toContain('SEGREDO-PPPOE');
      expect(contexto).not.toContain('OUTRO-SEGREDO');
      expect(contexto).not.toContain('cliente-dw');
    });

    test('sempre instrui o formato do WhatsApp em vez de markdown', async () => {
      sgpClient.lookupClientByCpf.mockResolvedValue({ contracts: [] });
      const contexto = await contextoDoSistema();
      expect(contexto).toMatch(/whatsapp/i);
      expect(contexto).toContain('*um asterisco*');
    });
  });

  test('ao bater o limite de ferramentas, pede uma resposta final sem ferramentas em vez de sair sem texto', async () => {
    // "Consulte todos os contratos" pode passar do orçamento do turno. Sem esta
    // saída, o turno terminava com texto nulo e o atendente ficava sem
    // sugestão nenhuma — justamente no cliente com vários contratos.
    getAiConfig.mockResolvedValue({
      apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 1,
    });
    createChatCompletion
      .mockResolvedValueOnce({
        message: {
          role: 'assistant', content: null,
          tool_calls: [
            { id: 't1', function: { name: 'consultar_plano', arguments: '{"contratoId":1}' } },
            { id: 't2', function: { name: 'consultar_plano', arguments: '{"contratoId":2}' } },
          ],
        },
        usage: {},
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Consegui verificar só parte dos contratos.' },
        usage: {},
      });

    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(result.texto).toBe('Consegui verificar só parte dos contratos.');
    expect(result.erro).toBe('tool_limit_reached');
    expect(executeTool).not.toHaveBeenCalled();
    const segundaChamada = createChatCompletion.mock.calls[1][0];
    expect(segundaChamada.tools || []).toHaveLength(0);
    expect(segundaChamada.messages[segundaChamada.messages.length - 1].role).toBe('system');
  });

  test('puts the existing reasons and sectors in the system context', async () => {
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    const systemMessage = createChatCompletion.mock.calls[0][0].messages[0];
    expect(systemMessage.role).toBe('system');
    expect(systemMessage.content).toContain('Lentidão');
    expect(systemMessage.content).toContain('r-1');
    expect(systemMessage.content).toContain('Suporte');
  });

  test('executes a requested tool and feeds the result back to the model', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'consultar_plano', arguments: '{"contratoId":17402}' } }],
        },
        usage: { promptTokens: 100, completionTokens: 20 },
      })
      .mockResolvedValueOnce({ message: { content: 'Seu plano é 600MB.' }, usage: { promptTokens: 150, completionTokens: 12 } });
    executeTool.mockResolvedValue({ ok: true, resultado: { plano: '600MB' } });

    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(executeTool).toHaveBeenCalledWith('consultar_plano', { contratoId: 17402 }, expect.any(Object));
    const segundaChamada = createChatCompletion.mock.calls[1][0].messages;
    const toolMessage = segundaChamada.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toEqual({ plano: '600MB' });
    expect(result.texto).toBe('Seu plano é 600MB.');
  });

  test('feeds a refusal back to the model instead of crashing', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { tool_calls: [{ id: 'c1', function: { name: 'consultar_plano', arguments: '{"contratoId":99999}' } }] },
        usage: {},
      })
      .mockResolvedValueOnce({ message: { content: 'Não consegui verificar esse contrato.' }, usage: {} });
    executeTool.mockResolvedValue({ ok: false, motivo: 'contract_not_owned', detalhe: 99999 });

    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const toolMessage = createChatCompletion.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content).erro).toBe('contract_not_owned');
    expect(result.texto).toBe('Não consegui verificar esse contrato.');
  });

  // Correção 2: um motivo de recusa inesperado carrega texto interno em
  // `detalhe` (ex.: "connect ECONNREFUSED 10.0.0.5:5432"). Isso não pode
  // entrar no contexto do modelo, só na auditoria.
  test('does not send the refusal detalhe to the model, but keeps it for the audit', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { tool_calls: [{ id: 'c1', function: { name: 'consultar_plano', arguments: '{"contratoId":17402}' } }] },
        usage: {},
      })
      .mockResolvedValueOnce({ message: { content: 'Não consegui verificar isso agora.' }, usage: {} });
    executeTool.mockResolvedValue({
      ok: false,
      motivo: 'execution_error',
      detalhe: 'connect ECONNREFUSED 10.0.0.5:5432',
    });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const toolMessage = createChatCompletion.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toEqual({ erro: 'execution_error' });
    expect(toolMessage.content).not.toContain('ECONNREFUSED');

    expect(recordAiInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        toolsRefused: expect.arrayContaining([
          expect.objectContaining({ motivo: 'execution_error', detalhe: 'connect ECONNREFUSED 10.0.0.5:5432' }),
        ]),
      })
    );
  });

  // Defeito D: a instrução de uma recusa que a declara chega ao modelo; o
  // detalhe cru (texto interno) continua só na auditoria.
  test('a recusa com instrução a repassa ao modelo, sem o detalhe cru', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { tool_calls: [{ id: 'c1', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } }] },
        usage: {},
      })
      .mockResolvedValueOnce({ message: { content: 'Pode me informar seu CPF?' }, usage: {} });
    executeTool.mockResolvedValue({
      ok: false,
      motivo: 'identity_not_confirmed',
      detalhe: 'enviar_boleto',
      instrucao: 'Identidade ainda não confirmada. Peça o CPF ou CNPJ e chame buscar_cliente; depois chame esta ferramenta de novo.',
    });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const toolMessage = createChatCompletion.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toEqual({
      erro: 'identity_not_confirmed',
      instrucao: 'Identidade ainda não confirmada. Peça o CPF ou CNPJ e chame buscar_cliente; depois chame esta ferramenta de novo.',
    });
  });

  test('stops at the tool ceiling instead of looping forever', async () => {
    getAiConfig.mockResolvedValue({
      apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 2,
    });
    createChatCompletion.mockResolvedValue({
      message: { tool_calls: [{ id: 'c', function: { name: 'consultar_plano', arguments: '{"contratoId":17402}' } }] },
      usage: {},
    });
    executeTool.mockResolvedValue({ ok: true, resultado: {} });

    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(executeTool.mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.erro).toBe('tool_limit_reached');
  });

  // Fix 5 (final review): there was a tool ceiling and per-call timeouts (60s
  // OpenAI, 15s per tool) but no wall clock for the whole turn — worst case,
  // roughly eight OpenAI round trips plus tools, minutes of one job holding the
  // worker (Bull's default concurrency is 1) while other conversations wait.
  test('stops at the global turn timeout instead of running forever', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    // Each simulated OpenAI round trip "takes" 70s: two of them cross the 120s
    // ceiling, so the loop must stop before a third call is ever made.
    createChatCompletion.mockImplementation(async () => {
      now += 70000;
      return {
        message: { tool_calls: [{ id: 'c', function: { name: 'consultar_plano', arguments: '{"contratoId":17402}' } }] },
        usage: {},
      };
    });
    executeTool.mockResolvedValue({ ok: true, resultado: {} });

    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(result.erro).toBe('turn_timeout');
    expect(createChatCompletion.mock.calls.length).toBeLessThanOrEqual(2);
    expect(recordAiInteraction).toHaveBeenCalledWith(expect.objectContaining({ error: 'turn_timeout' }));

    Date.now.mockRestore();
  });

  test('records the interaction for auditing even when it fails', async () => {
    createChatCompletion.mockRejectedValue(new Error('openai down'));
    const result = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    expect(result.texto).toBeNull();
    expect(result.erro).toBeTruthy();
    expect(recordAiInteraction).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c-1', error: expect.any(String) }));
  });

  // Fix 4 (final review): buscar_cliente's args carry the customer's full CPF.
  // toolsRequested feeds ai_interactions.tools_requested (the audit table), which
  // must never store the document in clear. maskDocument (sgp-normalizer.js) is
  // the existing masking helper; this proves it is actually wired in, and that
  // the real (unmasked) document still reaches the tool itself.
  test('masks a cpf/documento argument in the audit trail, but still passes the real one to the tool', async () => {
    const { maskDocument } = require('./sgp-normalizer');
    createChatCompletion
      .mockResolvedValueOnce({
        message: {
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'buscar_cliente', arguments: '{"cpf":"52998224725"}' } }],
        },
        usage: {},
      })
      .mockResolvedValueOnce({ message: { content: 'Encontrei seu cadastro.' }, usage: {} });
    executeTool.mockResolvedValue({ ok: true, resultado: { cliente: { nome: 'Ana' } } });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(executeTool).toHaveBeenCalledWith('buscar_cliente', { cpf: '52998224725' }, expect.any(Object));
    const { toolsRequested } = recordAiInteraction.mock.calls[0][0];
    expect(toolsRequested).toEqual([{ nome: 'buscar_cliente', args: { cpf: maskDocument('52998224725') } }]);
    expect(JSON.stringify(toolsRequested)).not.toContain('52998224725');
  });

  test('never sends the api key inside the messages', async () => {
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    const { messages } = createChatCompletion.mock.calls[0][0];
    expect(JSON.stringify(messages)).not.toContain('sk');
  });

  test('o histórico usa o texto do áudio transcrito', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'inbound', content: null, messageType: 'audio',
        transcription: 'minha internet caiu ontem', transcriptionStatus: 'completed' },
      { direction: 'inbound', content: 'e até agora não voltou', messageType: 'text' },
    ]);
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const { messages } = createChatCompletion.mock.calls[0][0];
    const conteudos = messages.map((m) => m.content).join(' | ');
    expect(conteudos).toContain('minha internet caiu ontem');
    expect(conteudos).toContain('e até agora não voltou');
  });

  test('áudio sem transcrição concluída fica fora do histórico', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      // Finding 3 (fix round 1): transcription não-nulo com status 'pending'
      // é um estado real — markTranscriptionProcessing muda o status sem
      // apagar uma transcrição anterior. Com transcription: null a checagem
      // de status podia ser removida sem o teste perceber (content/
      // transcription já eram falsy por conta própria); com texto presente
      // e status != 'completed', só a checagem de status salva o teste.
      { direction: 'inbound', content: null, messageType: 'audio',
        transcription: 'texto parcial', transcriptionStatus: 'pending' },
      { direction: 'inbound', content: 'oi', messageType: 'text' },
    ]);
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const { messages } = createChatCompletion.mock.calls[0][0];
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });
});

describe('perfil de triagem', () => {
  const IDENT_FORTE = {
    nivel: 'forte', origem: 'phone', primeiroNome: 'João', nome: 'João Da Silva Pereira',
    contracts: [{ id: 17402, statusCode: 1, plan: '600MB', address: 'RUA X', login: 'joao.pppoe' }],
    client: { id: 9, document: '11122233344' }, contestado: false,
  };
  const TRIAGEM = { threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false };

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: 'Seja breve.', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-1', name: 'Financeiro', aiHint: 'Boleto, PIX, cobrança.' }, { id: 's-2', name: 'Suporte', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Segunda via' }]);
    listToolPermissions.mockResolvedValue([{ toolName: 'desbloqueio_confianca', enabled: true }]);
    // mockReset (e não só o clear do beforeEach de topo): sem isto um
    // mockResolvedValue persistente de outro describe atende as chamadas que
    // sobram de uma fila de mockResolvedValueOnce curta, e um teste passa por
    // acidente em vez de falhar por chamada não prevista.
    createChatCompletion.mockReset();
    createChatCompletion.mockResolvedValue({ message: { content: 'Oi, João!' }, usage: {} });
  });

  async function contexto(extra = {}) {
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto', ...extra });
    return createChatCompletion.mock.calls[0][0];
  }

  test('manda só a lista fixa de ferramentas, ignorando o cartão de permissões', async () => {
    const req = await contexto();
    const nomes = req.tools.map((t) => t.function.name).sort();
    expect(nomes).toEqual([...FERRAMENTAS_TRIAGEM].sort());
    expect(nomes).not.toContain('desbloqueio_confianca');
    // Nominal: nenhuma ferramenta do assistente clássico (fora da lista fixa
    // de dez) pode vazar para a triagem por engano.
    expect(FERRAMENTAS_TRIAGEM).not.toEqual(expect.arrayContaining([
      'consultar_plano', 'transferir_atendimento', 'definir_motivo_atendimento',
      'desbloqueio_confianca', 'consultar_financeiro', 'consultar_faturas',
    ]));
    // Teste real 2026-09-15: gerar_segunda_via só devolve linha e link ao
    // modelo (não envia nada) e marcava a triagem como resolvida — com ela na
    // lista, o modelo dizia "enviei acima o boleto" sem nenhum envio. Na
    // triagem quem entrega é enviar_boleto; a segunda via fica no assistente.
    expect(FERRAMENTAS_TRIAGEM).not.toContain('gerar_segunda_via');
  });

  describe('perfil noturno', () => {
    const NOTURNO = { ...TRIAGEM, maxQuestions: 4, noturno: { ativo: true, retornoAs: '08:00' } };

    test('à noite a lista fixa ganha desbloqueio_confianca e analisar_comprovante; de dia não', async () => {
      const req = await contexto({ triagem: NOTURNO });
      const nomes = req.tools.map((t) => t.function.name);
      // As duas já chegam à OpenAI: com a ferramenta registrada, toOpenAiTools
      // não filtra mais o nome em silêncio.
      expect(nomes).toEqual(expect.arrayContaining(['desbloqueio_confianca', 'analisar_comprovante']));
      expect(FERRAMENTAS_TRIAGEM_NOTURNO).toEqual(expect.arrayContaining(['desbloqueio_confianca', 'analisar_comprovante']));
      jest.clearAllMocks();
      createChatCompletion.mockResolvedValue({ message: { content: 'Oi' }, usage: {} });
      const dia = await contexto();
      expect(dia.tools.map((t) => t.function.name)).not.toEqual(expect.arrayContaining(['desbloqueio_confianca', 'analisar_comprovante']));
    });

    // Task 18: o CONTEÚDO do bloco noturno (hora de retorno, nada de prometer
    // solução imediata, as duas etapas da conexão, o roteiro do comprovante)
    // é testado em src/ai/prompt/fluxos/noturno.test.js e comprovante.test.js;
    // a SELEÇÃO (de dia o bloco não entra) em prompt/montar.test.js. Aqui fica
    // só a fiação: o estado noturno do turno chega ao compositor.
    test('o modo noturno do turno chega ao compositor, com a hora de retorno interpolada', async () => {
      const sys = (await contexto({ triagem: NOTURNO })).messages[0].content;
      expect(sys).toMatch(/MODO NOTURNO/);
      expect(sys).toMatch(/A equipe volta às 08:00/);
      createChatCompletion.mockClear();
      expect((await contexto()).messages[0].content).not.toMatch(/MODO NOTURNO/);
    });
  });

  // Leitura de comprovante TAMBÉM de dia: conferência e aviso à atendente, sem
  // desbloqueio nenhum. É a única ferramenta que a flag acrescenta.
  describe('leitura de comprovante de dia (triageReadReceiptsDaytime)', () => {
    const NOTURNO = { ...TRIAGEM, maxQuestions: 4, noturno: { ativo: true, retornoAs: '08:00' } };
    const configLendoDeDia = {
      apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
      maxToolsPerInteraction: 8, triageExtraInstructions: 'Seja breve.',
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null,
      triageReadReceiptsDaytime: true,
    };

    test('com a flag desligada, de dia a lista fixa não muda', async () => {
      const nomes = (await contexto()).tools.map((t) => t.function.name).sort();
      expect(nomes).toEqual([...FERRAMENTAS_TRIAGEM].sort());
      expect(nomes).not.toContain('analisar_comprovante');
    });

    // O desbloqueio continua sendo só da noite: de dia há atendente, e a
    // liberação em confiança é decisão de gente.
    test('com a flag ligada, de dia entra analisar_comprovante e SÓ ela', async () => {
      getAiConfig.mockResolvedValue(configLendoDeDia);
      const nomes = (await contexto()).tools.map((t) => t.function.name).sort();
      expect(nomes).toContain('analisar_comprovante');
      expect(nomes).not.toContain('desbloqueio_confianca');
      expect(nomes).toEqual([...FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA].sort());
      expect(FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA).toHaveLength(FERRAMENTAS_TRIAGEM.length + 1);
    });

    test('à noite a flag não muda nada: a lista noturna continua a mesma', async () => {
      getAiConfig.mockResolvedValue(configLendoDeDia);
      const nomes = (await contexto({ triagem: NOTURNO })).tools.map((t) => t.function.name).sort();
      expect(nomes).toEqual([...FERRAMENTAS_TRIAGEM_NOTURNO].sort());
      expect(nomes).toContain('desbloqueio_confianca');
    });

    // Task 18: os dois textos do comprovante (com e sem a ferramenta, de dia e
    // de noite) são testados em prompt/fluxos/comprovante.test.js. Aqui fica a
    // fiação: a lista de ferramentas DO TURNO é o que decide qual ramo o
    // compositor emite — é ela que a flag muda.
    test('a lista de ferramentas do turno chega ao compositor e decide o ramo do comprovante', async () => {
      // Sem a flag (padrão de fábrica): a ferramenta não está na lista do turno.
      const semFlag = (await contexto()).messages[0].content;
      expect(semFlag).not.toMatch(/chame analisar_comprovante/);
      expect(semFlag).toMatch(/Se o cliente enviou uma imagem, pergunte se é um comprovante/);

      getAiConfig.mockResolvedValue(configLendoDeDia);
      createChatCompletion.mockClear();
      const comFlag = (await contexto()).messages[0].content;
      expect(comFlag).toMatch(/chame analisar_comprovante/);
    });
  });

  // =====================================================================
  // Task 18 — a fiação entre o turno e o compositor de módulos
  // =====================================================================
  // O construtor monolítico montarContextoTriagem deixou de existir: quem
  // monta o contexto da triagem agora é montarContexto(estado), em
  // src/ai/prompt/montar.js. O TEXTO de cada regra é testado módulo a módulo
  // (src/ai/prompt/**/*.test.js) e a seleção de módulo por estado em
  // prompt/montar.test.js — nenhum assert de frase literal sobrou aqui.
  //
  // O que estes testes guardam é a outra metade do contrato, que nenhum teste
  // de módulo alcança: que o turno entrega ao compositor, correto e completo,
  // tudo o que ele precisa. Uma regressão nesta fiação não muda uma frase —
  // apaga um bloco inteiro do prompt com todos os testes de módulo verdes.
  describe('o contexto da triagem é montado pelo compositor de módulos', () => {
    test('a ordem de montagem começa pelo prompt do painel e põe os princípios em seguida', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys.indexOf('Você é a assistente.')).toBe(0);
      expect(sys).toContain('PRIORIDADE');
      expect(sys.indexOf('PRIORIDADE')).toBeLessThan(sys.indexOf('Setores'));
    });

    test('setores, motivos e instruções da operação chegam do banco ao compositor', async () => {
      const sys = (await contexto()).messages[0].content;
      // listSectors/listActiveReasons mockados no beforeEach deste describe.
      expect(sys).toContain('s-1 = Financeiro — Boleto, PIX, cobrança.');
      expect(sys).toContain('s-2 = Suporte');
      expect(sys).toContain('r-1 = Segunda via');
      // config.triageExtraInstructions, repassada verbatim pelo painel.
      expect(sys).toContain('Seja breve.');
    });

    test('a identidade do turno chega ao compositor com o primeiro nome e os contratos', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toContain('João');
      expect(sys).toContain('RUA X');
    });

    // I3 (review): a fixture IDENT_FORTE carrega CPF, login PPPoE e sobrenome
    // de verdade. Os contratos passam por normalizeContract ANTES de virarem
    // estado do compositor (é o que tira login e senha PPPoE), e da identidade
    // só o primeiro nome atravessa.
    test('os contratos passam pelo normalizador, e da identidade só o primeiro nome atravessa', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).not.toContain('11122233344');
      expect(sys).not.toContain('pppoe');
      expect(sys).not.toContain('Silva');
    });

    // Nenhum nome de provedor fica embutido no código (o chat será vendido): o
    // nome vem do cartão Empresa, e sem cadastro a frase continua de pé.
    test('o nome da empresa cadastrada chega ao compositor, e sem cadastro cai no genérico', async () => {
      const comNome = (await contexto()).messages[0].content;
      expect(comNome).toContain('Você é a primeira atendente virtual da Provedor X.');
      expect(comNome).not.toMatch(/DW/);

      createChatCompletion.mockClear();
      getCompanyConfig.mockResolvedValue({ id: null, name: '', acceptedPayeeNames: [] });
      const semNome = (await contexto()).messages[0].content;
      expect(semNome).toContain('Você é a primeira atendente virtual da empresa.');
    });

    // montarContexto é SÍNCRONA e determinística de propósito: quem lê o
    // relógio é o turno, que passa `agora` no estado. Sem isso o modelo fica
    // sem data (não conta dias de atraso) e sem hora (erra a saudação).
    test('o relógio do turno chega ao compositor em agora', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-13T13:05:00-03:00'));
      try {
        const sys = (await contexto()).messages[0].content;
        expect(sys).toContain('Hoje é 13/09/2026 e agora são 13:05 em Brasília.');
      } finally {
        jest.useRealTimers();
      }
    });

    // Sem esta passagem, a triagem pede reinício de equipamento a quem está no
    // meio de uma falha regional que a empresa já conhece.
    test('o aviso de cidade do turno chega ao compositor, com cidade e mensagem interpoladas', async () => {
      const sys = (await contexto({
        avisoCidade: { cidade: 'Cândido Mendes', mensagem: 'Rompimento de fibra; equipe em campo.' },
      })).messages[0].content;
      expect(sys).toContain('AVISO ATIVO NA CIDADE DO CLIENTE (Cândido Mendes): Rompimento de fibra; equipe em campo.');
    });

    // Com o motivo de encerramento configurado, a triagem deixa de encaminhar
    // o cliente que só queria o boleto/PIX: ela mesma fecha o atendimento. A
    // chave é config.triageResolvedReasonId chegar ao compositor.
    test('o motivo de encerramento configurado chega ao compositor e troca o ramo do fluxo financeiro', async () => {
      expect((await contexto()).messages[0].content).not.toMatch(/chame encerrar_atendimento/);

      createChatCompletion.mockClear();
      getAiConfig.mockResolvedValue({
        apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
        maxToolsPerInteraction: 8, triageExtraInstructions: '', triageConfidenceThreshold: 0.8,
        triageMaxQuestions: 2, triageResolvedReasonId: 'rr-1',
      });
      expect((await contexto()).messages[0].content).toMatch(/chame encerrar_atendimento/);
    });

    // Setores e motivos são duas consultas independentes e o turno inteiro
    // espera pelas duas antes da primeira chamada à OpenAI: elas vão em
    // paralelo. Sequenciá-las seria uma regressão de latência silenciosa —
    // nenhum assert de conteúdo pegaria.
    test('setores e motivos são consultados em paralelo, não em sequência', async () => {
      let motivosPedidos = false;
      let setoresTerminouAntesDeMotivosComecar = false;
      listSectors.mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        if (!motivosPedidos) setoresTerminouAntesDeMotivosComecar = true;
        return [{ id: 's-1', name: 'Financeiro', aiHint: 'Boleto, PIX, cobrança.' }];
      });
      listActiveReasons.mockImplementation(async () => {
        motivosPedidos = true;
        return [{ id: 'r-1', name: 'Segunda via' }];
      });
      await contexto();
      expect(setoresTerminouAntesDeMotivosComecar).toBe(false);
    });
  });

  test('o registro de ferramentas do contexto recebe nome e resultado compactos', async () => {
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Não encontrei boleto em aberto.' }, usage: {} });
    let ctxVisto;
    executeTool.mockImplementation(async (nome, args, ctx) => { ctxVisto = ctx; return { ok: true, resultado: { enviado: false, motivo: 'Nenhuma fatura em aberto' } }; });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM });
    expect(ctxVisto.registroFerramentas).toEqual([{ nome: 'enviar_boleto', resultado: '{"enviado":false,"motivo":"Nenhuma fatura em aberto"}' }]);
  });

  // Rodada de correção 1 (Task 11): enviar_boleto/gerar_pix carregam um
  // `instrucao` longo (o texto do modelo de frase para o cliente) que sozinho
  // já passa de 200 caracteres — o corte antigo cortava o JSON no meio, antes
  // de legivel (tool-registry.js) poder filtrar esse campo para o resumo.
  // Um resultado do TAMANHO REAL dessas ferramentas precisa sobreviver
  // intacto aqui: é o texto de verdade que enviar_boleto.executar devolve
  // (conferido em tool-registry.test.js), não um exagero artificial.
  test('um resultado do tamanho real de enviar_boleto/gerar_pix não é truncado no registro', async () => {
    const resultadoRealista = {
      enviado: true,
      valor: 89.9,
      vencimento: '2026-09-20',
      linhaDigitavelEnviada: true,
      instrucao: 'O boleto já foi enviado ao cliente nesta conversa em PDF e com a linha digitável em mensagem separada. Comece pelo primeiro nome do cliente ("Prontinho, João!"). Responda EXATAMENTE no modelo, sem emoji: "Enviei acima o boleto referente ao seu contrato do endereço RUA X, em PDF e com a linha digitável. É só pagar pelo aplicativo do seu banco, copiando a linha digitável, ou em qualquer lotérica. Se tiver alguma dificuldade, me avise que eu te ajudo!" NÃO repita a linha digitável nem o valor.',
    };
    expect(JSON.stringify(resultadoRealista).length).toBeGreaterThan(200);
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Prontinho!' }, usage: {} });
    let ctxVisto;
    executeTool.mockImplementation(async (nome, args, ctx) => { ctxVisto = ctx; return { ok: true, resultado: resultadoRealista }; });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM });
    const guardado = ctxVisto.registroFerramentas[0].resultado;
    expect(guardado).toBe(JSON.stringify(resultadoRealista));
    expect(guardado).not.toMatch(/…\(truncado\)/);
    expect(() => JSON.parse(guardado)).not.toThrow();
  });

  // I3 (review): a fixture original (IDENT_FORTE) não tinha nenhum campo
  // perigoso — um teste de "não vaza nada" que não pode vazar nada não prova
  // nada. Agora o fixture carrega CPF, login PPPoE e sobrenome de verdade.
  // Teste real 2026-09-14: depois de identificar, o modelo escreveu "Perfeito.
  // Vou seguir com o Pix do contrato em aberto." e não chamou gerar_pix — o
  // cliente teve de dizer "pode mandar" para receber o que já tinha pedido.
  describe('anunciou o envio mas não entregou', () => {
    test('"Vou seguir com o Pix do contrato em aberto." obriga a ferramenta de entrega', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Perfeito. Vou seguir com o Pix do contrato em aberto.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'gerar_pix', arguments: '{"contratoId":17402}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Enviei acima o PIX, João.' }, usage: {} });
      executeTool.mockImplementation(async (nome, args, ctx) => {
        ctx.resolvidoPelaIa = true;
        return { ok: true, resultado: { enviado: true } };
      });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      const segunda = createChatCompletion.mock.calls[1][0];
      expect(segunda.toolChoice).toBe('required');
      // messages é o mesmo array mutado a cada volta: procurar a mensagem em
      // vez de olhar a última posição.
      expect(segunda.messages).toEqual(expect.arrayContaining([{
        role: 'system',
        content: 'Você disse que vai enviar, mas não chamou gerar_pix/enviar_boleto. Chame a ferramenta de entrega AGORA (o contrato único, ou o escolhido) e depois responda.',
      }]));
      expect(segunda.messages).toEqual(expect.arrayContaining([{
        role: 'assistant',
        content: 'Perfeito. Vou seguir com o Pix do contrato em aberto.',
      }]));
      expect(r.texto).toBe('Enviei acima o PIX, João.');
    });

    // Teste real 2026-09-15 (produção): o cliente pediu o boleto e o modelo
    // respondeu "Enviei acima o boleto referente ao seu contrato do endereço
    // Agenor Costa, em PDF e com a linha digitável..." sem chamar
    // enviar_boleto — nada chegou ao cliente. A guarda só olhava o futuro
    // ("vou enviar"); a afirmação no passado passava direto.
    test('"Enviei acima o boleto..." sem ferramenta de entrega obriga a entrega', async () => {
      const afirmacao = 'Enviei acima o boleto referente ao seu contrato do endereço Agenor Costa, em PDF e com a linha digitável. É só pagar pelo aplicativo do seu banco, copiando a linha digitável, ou em qualquer lotérica. Se tiver alguma dificuldade, me avise que eu te ajudo!';
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: afirmacao }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Enviei acima o boleto, João.' }, usage: {} });
      executeTool.mockImplementation(async (nome, args, ctx) => {
        ctx.resolvidoPelaIa = true;
        return { ok: true, resultado: { enviado: true } };
      });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      const segunda = createChatCompletion.mock.calls[1][0];
      expect(segunda.toolChoice).toBe('required');
      expect(segunda.messages).toEqual(expect.arrayContaining([{
        role: 'system',
        content: 'Você disse que vai enviar, mas não chamou gerar_pix/enviar_boleto. Chame a ferramenta de entrega AGORA (o contrato único, ou o escolhido) e depois responda.',
      }]));
      expect(executeTool).toHaveBeenCalledWith('enviar_boleto', { contratoId: 17402 }, expect.any(Object));
      expect(r.texto).toBe('Enviei acima o boleto, João.');
    });

    test('afirmaEnvio: pega a promessa no futuro e a afirmação no passado, sem falso positivo', () => {
      const { afirmaEnvio } = require('./ai-orchestrator');
      expect(afirmaEnvio('Perfeito. Vou seguir com o Pix do contrato em aberto.')).toBe(true);
      expect(afirmaEnvio('Enviei acima o boleto referente ao seu contrato, em PDF.')).toBe(true);
      expect(afirmaEnvio('Enviei acima o PIX, João.')).toBe(true);
      expect(afirmaEnvio('Mandei o código PIX aqui em cima.')).toBe(true);
      expect(afirmaEnvio('Segue o boleto em PDF com a linha digitável.')).toBe(true);
      expect(afirmaEnvio('Claro, João! De qual endereço você precisa?')).toBe(false);
      expect(afirmaEnvio('Encaminhei seu atendimento para o Financeiro.')).toBe(false);
      expect(afirmaEnvio('Enviei seu pedido para a equipe conferir.')).toBe(false);
    });

    test('texto sem anúncio de envio não dá volta nenhuma', async () => {
      createChatCompletion.mockResolvedValueOnce({ message: { content: 'Claro, João! De qual endereço você precisa?' }, usage: {} });

      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });

    test('anúncio com a entrega já feita no turno não dá volta extra', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'gerar_pix', arguments: '{"contratoId":17402}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Pronto! Vou te enviar o PIX agora mesmo.' }, usage: {} });
      executeTool.mockImplementation(async (nome, args, ctx) => {
        ctx.resolvidoPelaIa = true;
        return { ok: true, resultado: { enviado: true } };
      });

      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(createChatCompletion).toHaveBeenCalledTimes(2);
    });

    // Fix round 1: a volta forcada de entrega nascia sujeita ao teto de
    // ferramentas, entao no turno que ja gastou o limite ela era barrada por
    // ele mesmo — o cliente ficava com a promessa e sem o Pix, que e
    // exatamente o defeito que a guarda existe para fechar. As conclusoes
    // forcadas ja tinham essa isencao.
    test('a entrega forcada passa mesmo com o teto de ferramentas ja estourado', async () => {
      getAiConfig.mockResolvedValue({
        apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
        maxToolsPerInteraction: 2, triageExtraInstructions: 'Seja breve.',
        triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null,
      });
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [
          { id: 't1', function: { name: 'consultar_status_todos_contratos', arguments: '{}' } },
          { id: 't2', function: { name: 'consultar_faturas_todos_contratos', arguments: '{}' } },
        ] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Perfeito. Vou seguir com o Pix do contrato em aberto.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't3', function: { name: 'gerar_pix', arguments: '{"contratoId":17402}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Enviei acima o PIX, João.' }, usage: {} });
      executeTool.mockImplementation(async (nome, args, ctx) => {
        if (nome === 'gerar_pix') ctx.resolvidoPelaIa = true;
        return { ok: true, resultado: { enviado: true } };
      });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(createChatCompletion.mock.calls[2][0].toolChoice).toBe('required');
      expect(executeTool).toHaveBeenCalledWith('gerar_pix', { contratoId: 17402 }, expect.any(Object));
      expect(r.erro).toBeNull();
      expect(r.texto).toBe('Enviei acima o PIX, João.');
    });

    // A isencao e so da volta forcada: uma chamada espontanea de gerar_pix
    // depois do teto continua barrada, senao o limite nao limitaria nada.
    test('sem a volta forcada, gerar_pix depois do teto continua barrado', async () => {
      getAiConfig.mockResolvedValue({
        apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
        maxToolsPerInteraction: 2, triageExtraInstructions: 'Seja breve.',
        triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null,
      });
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [
          { id: 't1', function: { name: 'consultar_status_todos_contratos', arguments: '{}' } },
          { id: 't2', function: { name: 'consultar_faturas_todos_contratos', arguments: '{}' } },
        ] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't3', function: { name: 'gerar_pix', arguments: '{"contratoId":17402}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't4', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Estou encaminhando, João.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });

      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(executeTool).not.toHaveBeenCalledWith('gerar_pix', expect.anything(), expect.anything());
      expect(createChatCompletion.mock.calls[2][0].toolChoice).toBe('concluir_triagem');
    });

    test('a exigência acontece uma vez só por turno', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Vou gerar o PIX para você.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Vou gerar o PIX para você.' }, usage: {} });

      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(createChatCompletion).toHaveBeenCalledTimes(2);
    });
  });

  test('imagem e documento entram no histórico como placeholder', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'inbound', content: null, messageType: 'image' },
      { direction: 'inbound', content: 'já paguei', messageType: 'text' },
    ]);
    const req = await contexto();
    expect(req.messages.map((m) => m.content).join('|')).toContain('[cliente enviou uma imagem]');
  });

  // Minor (review): a legenda que acompanha a mídia é informação real da
  // triagem (o cliente pode escrever "já paguei isso" na legenda da foto do
  // boleto) — perdê-la perderia contexto.
  test('a legenda acompanha o placeholder de imagem/documento quando existir', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'inbound', content: 'já paguei isso', messageType: 'image' },
      { direction: 'inbound', content: 'segue o contrato', messageType: 'document' },
    ]);
    const req = await contexto();
    const conteudos = req.messages.map((m) => m.content);
    expect(conteudos).toContain('[cliente enviou uma imagem] já paguei isso');
    expect(conteudos).toContain('[cliente enviou um documento] segue o contrato');
  });

  // I4a (review): documento inbound vira o placeholder; áudio inbound com
  // transcrição malsucedida (status 'failed', não só ausência de status)
  // também vira placeholder.
  test('documento inbound vira placeholder, e áudio com transcrição falha também', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'inbound', content: null, messageType: 'document' },
      { direction: 'inbound', content: null, messageType: 'audio', transcriptionStatus: 'failed' },
    ]);
    const req = await contexto();
    const conteudos = req.messages.map((m) => m.content);
    expect(conteudos).toContain('[cliente enviou um documento]');
    expect(conteudos).toContain('[cliente enviou um áudio que não pôde ser transcrito]');
  });

  // I4b (review): o boleto que a própria IA envia (enviar_boleto) entra no
  // histórico como uma mensagem outbound messageType 'document' — isso NUNCA
  // pode virar "[cliente enviou um documento]", ou o modelo se confunde
  // sobre quem mandou o quê.
  test('documento outbound (o boleto que a IA enviou) não vira o placeholder do cliente', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'outbound', content: null, messageType: 'document' },
      { direction: 'inbound', content: 'oi', messageType: 'text' },
    ]);
    const req = await contexto();
    expect(req.messages.map((m) => m.content)).not.toContain('[cliente enviou um documento]');
  });

  // O código Pix é uma parede de ~200 caracteres sem sentido para o modelo, e
  // devolvê-lo ao cliente numa resposta gerada seria pior ainda: o histórico
  // registra só que o cartão foi enviado.
  test('cartão de Pix outbound vira placeholder, sem o código', async () => {
    const PIX = '00020126580014BR.GOV.BCB.PIX0136chave-pix5204000053039865802BR';
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'outbound', content: PIX, messageType: 'pix' },
      { direction: 'inbound', content: 'recebi', messageType: 'text' },
    ]);
    const req = await contexto();
    const conteudos = req.messages.map((m) => m.content);
    expect(conteudos).toContain('[cartão Pix enviado ao cliente]');
    expect(JSON.stringify(req.messages)).not.toContain(PIX);
  });

  test('mensagem pix inbound não vira o placeholder de envio', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'inbound', content: '00020126580014BR.GOV.BCB.PIX', messageType: 'pix' },
      { direction: 'inbound', content: 'oi', messageType: 'text' },
    ]);
    const req = await contexto();
    expect(req.messages.map((m) => m.content)).not.toContain('[cartão Pix enviado ao cliente]');
  });

  test('forcarConclusao exige alguma ferramenta na primeira chamada e avisa o limite no contexto', async () => {
    // 'required', e não concluir_triagem: no 1º teste real com dois contratos,
    // forçar a conclusão impediu o modelo de entregar o PIX que já podia.
    const req = await contexto({ triagem: { ...TRIAGEM, attempts: 2, forcarConclusao: true } });
    expect(req.toolChoice).toBe('required');
    expect(req.messages[0].content).toMatch(/LIMITE DE PERGUNTAS ATINGIDO/);
    expect(req.messages[0].content).toMatch(/entregue AGORA \(enviar_boleto ou gerar_pix\) e em seguida chame concluir_triagem/);
  });

  test('sem forcarConclusao, o contexto não fala em limite atingido', async () => {
    const req = await contexto();
    expect(req.toolChoice).toBeUndefined();
    expect(req.messages[0].content).not.toMatch(/LIMITE DE PERGUNTAS ATINGIDO/);
  });

  // I4c (review): o toolChoice forçado não pode "grudar" nas chamadas
  // seguintes do turno, senão o modelo nunca conseguiria fazer a pergunta de
  // esclarecimento que a própria concluir_triagem pede em baixa confiança.
  test('forcarConclusao não persiste na segunda chamada do turno', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] },
        usage: {},
      })
      .mockResolvedValueOnce({ message: { content: 'ok' }, usage: {} });
    executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });
    await contexto({ triagem: { ...TRIAGEM, attempts: 2, forcarConclusao: true } });
    expect(createChatCompletion.mock.calls[0][0].toolChoice).toBe('required');
    expect(createChatCompletion.mock.calls[1][0].toolChoice).toBeUndefined();
  });

  // Teste real (2026-09-13): com vários contratos o Suporte estourou o teto de
  // ferramentas e o caminho antigo de tool_limit_reached fez a IA dizer "não
  // consegui confirmar o status da conexão, posso encaminhar para o suporte
  // verificar". Na triagem, o limite agora obriga concluir_triagem.
  describe('limite de ferramentas na triagem', () => {
    const CONFIG_APERTADA = {
      apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
      maxToolsPerInteraction: 2, triageExtraInstructions: '', triageConfidenceThreshold: 0.8,
      triageMaxQuestions: 2, triageResolvedReasonId: null,
    };
    const TRES_FERRAMENTAS = {
      message: {
        content: null,
        tool_calls: [
          { id: 't1', function: { name: 'consultar_status_todos_contratos', arguments: '{}' } },
          { id: 't2', function: { name: 'consultar_status_contrato', arguments: '{"contratoId":17402}' } },
          { id: 't3', function: { name: 'consultar_status_conexao', arguments: '{"contratoId":17402}' } },
        ],
      },
      usage: {},
    };
    const CONCLUSAO = {
      message: {
        content: null,
        tool_calls: [{ id: 't4', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"lentidão; conexão não consultada","confianca":0.9}' } }],
      },
      usage: {},
    };

    beforeEach(() => getAiConfig.mockResolvedValue(CONFIG_APERTADA));

    test('em vez de se desculpar, obriga concluir_triagem e executa a conclusão apesar do limite', async () => {
      createChatCompletion
        .mockResolvedValueOnce(TRES_FERRAMENTAS)
        .mockResolvedValueOnce(CONCLUSAO)
        .mockResolvedValueOnce({ message: { content: 'Já estou encaminhando para o Suporte, João.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      const segunda = createChatCompletion.mock.calls[1][0];
      expect(segunda.toolChoice).toBe('concluir_triagem');
      // O array de mensagens é o mesmo objeto ao longo do turno (o mock guarda a
      // referência), então checa-se a presença, não a posição final.
      expect(segunda.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringMatching(/Limite de consultas deste turno\. Chame concluir_triagem AGORA.*responda a pergunta dele se houver/) }),
        expect.objectContaining({ role: 'system', content: expect.stringMatching(/NUNCA que não conseguiu verificar algo/) }),
      ]));
      // A conclusão forçada não pode cair no mesmo limite que a provocou.
      expect(executeTool).toHaveBeenCalledWith('concluir_triagem', expect.objectContaining({ resumo: expect.any(String) }), expect.anything());
      expect(r.texto).toBe('Já estou encaminhando para o Suporte, João.');
      expect(r.erro).toBe('tool_limit_reached');
    });

    test('se o modelo insistir em consultar, cai no caminho antigo uma única vez', async () => {
      createChatCompletion
        .mockResolvedValueOnce(TRES_FERRAMENTAS)
        .mockResolvedValueOnce(TRES_FERRAMENTAS)
        .mockResolvedValueOnce({ message: { content: 'Vou encaminhar para o Suporte.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: {} });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(createChatCompletion).toHaveBeenCalledTimes(3);
      const terceira = createChatCompletion.mock.calls[2][0];
      expect(terceira.tools || []).toHaveLength(0);
      expect(terceira.messages[terceira.messages.length - 1].content).toMatch(/Não é possível fazer mais consultas neste turno/);
      expect(r.erro).toBe('tool_limit_reached');
      expect(executeTool).not.toHaveBeenCalled();
    });

    test('com a triagem já concluída, o limite segue o caminho antigo', async () => {
      createChatCompletion
        .mockResolvedValueOnce({
          message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] },
          usage: {},
        })
        .mockResolvedValueOnce(TRES_FERRAMENTAS)
        .mockResolvedValueOnce({ message: { content: 'Pronto, João.' }, usage: {} });
      executeTool.mockImplementation(async (nome, args, ctx) => {
        if (nome === 'concluir_triagem') ctx.triagemConcluida = { setorId: 's-2' };
        return { ok: true, resultado: { concluido: true } };
      });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      const terceira = createChatCompletion.mock.calls[2][0];
      expect(terceira.tools || []).toHaveLength(0);
      expect(terceira.messages[terceira.messages.length - 1].content).toMatch(/Não é possível fazer mais consultas neste turno/);
      expect(r.erro).toBe('tool_limit_reached');
    });
  });

  // Teste real do Suporte (2026-09-13): "vou encaminhar para o Suporte" sem
  // chamar concluir_triagem — o encaminhamento só veio no turno seguinte.
  describe('anúncio de encaminhamento sem concluir_triagem', () => {
    test('obriga concluir_triagem na mesma resposta e manda o texto final ao cliente', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Entendi. Vou encaminhar sua solicitação para o setor de Suporte.' }, usage: {} })
        .mockResolvedValueOnce({
          message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"lentidão","confianca":0.9}' } }] },
          usage: {},
        })
        .mockResolvedValueOnce({ message: { content: 'Perfeito, João — o Suporte continua daqui.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(createChatCompletion).toHaveBeenCalledTimes(3);
      const segunda = createChatCompletion.mock.calls[1][0];
      expect(segunda.toolChoice).toBe('concluir_triagem');
      // O array de mensagens é o mesmo objeto ao longo do turno (o mock guarda a
      // referência), então checa-se a presença, não a posição final.
      expect(segunda.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Entendi. Vou encaminhar sua solicitação para o setor de Suporte.' }),
        expect.objectContaining({ role: 'system', content: expect.stringMatching(/Chame concluir_triagem AGORA/) }),
      ]));
      expect(createChatCompletion.mock.calls[2][0].toolChoice).toBeUndefined();
      expect(executeTool).toHaveBeenCalledWith('concluir_triagem', expect.objectContaining({ resumo: 'lentidão' }), expect.anything());
      expect(r.texto).toBe('Perfeito, João — o Suporte continua daqui.');
    });

    test('só uma volta a mais: se o modelo insistir em só anunciar, o texto sai e o worker conclui em código', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Vou encaminhar seu atendimento para o Suporte.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Vou encaminhar seu atendimento para o Suporte.' }, usage: {} });
      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(r.texto).toBe('Vou encaminhar seu atendimento para o Suporte.');
    });

    test('"vou repassar isso para o setor" também conta como anúncio (2º teste real)', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Entendi. Vou repassar isso para o setor de Suporte verificando a conexão offline.' }, usage: {} })
        .mockResolvedValueOnce({
          message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"offline","confianca":0.9}' } }] },
          usage: {},
        })
        .mockResolvedValueOnce({ message: { content: 'Willemberg, o Suporte continua daqui.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });
      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });
      expect(createChatCompletion.mock.calls[1][0].toolChoice).toBe('concluir_triagem');
      expect(r.texto).toBe('Willemberg, o Suporte continua daqui.');
    });

    test('texto sem anúncio de encaminhamento não ganha volta extra', async () => {
      createChatCompletion.mockResolvedValueOnce({ message: { content: 'Me diz o endereço, por favor?' }, usage: {} });
      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, origemMensagem: 'texto' });
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });

    test('no assistente (humano no comando) o anúncio não força nada', async () => {
      createChatCompletion.mockResolvedValueOnce({ message: { content: 'Vou encaminhar seu atendimento para o Suporte.' }, usage: {} });
      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });
  });

  // À noite a IA age sozinha: se ela ANUNCIAR uma liberação ou um
  // encaminhamento que não aconteceram, ninguém corrige antes do cliente ler.
  describe('afirmações que precisam de fato', () => {
    const NOTURNO = { ...TRIAGEM, noturno: { ativo: true, retornoAs: '08:00' } };
    // O erro que este ramo evita é o oposto do anterior e igualmente grave: a
    // liberação ACONTECEU num turno anterior (o cliente volta e pergunta "foi
    // liberado?") e o verificador obrigaria a IA a desmentir um fato.
    test('liberação recente no banco: a afirmação passa sem correção nenhuma', async () => {
      hasRecentTrustUnlockByContact.mockResolvedValue(true);
      createChatCompletion.mockResolvedValueOnce({ message: { content: 'Prontinho, João! O desbloqueio em confiança foi realizado.' }, usage: {} });
      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
      expect(hasRecentTrustUnlockByContact).toHaveBeenCalledWith('ct-1', 24 * 60 * 60 * 1000);
      expect(r.texto).toBe('Prontinho, João! O desbloqueio em confiança foi realizado.');
    });

    test('o banco é consultado uma vez só, mesmo com o laço dando outra volta', async () => {
      hasRecentTrustUnlockByContact.mockResolvedValue(true);
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'O desbloqueio em confiança foi realizado. Já deixei seu atendimento na fila.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'O desbloqueio em confiança foi realizado, João.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });
      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });
      expect(hasRecentTrustUnlockByContact).toHaveBeenCalledTimes(1);
    });

    // Achado 2 do fix round 1: o texto corrigido diz ao cliente que o
    // comprovante "fica registrado para a equipe conferir". Se a triagem não
    // concluir, isso é falso — a conversa fica na automação, não na fila.
    // Teste único do caminho de correção (a versão anterior, que só checava a
    // regeneração, passava por acidente: a fila de mocks acabava antes da volta
    // de conclusão e a chamada caía num mockResolvedValue persistente de outro
    // describe). Este fornece TODAS as chamadas que o caminho exige.
    test('"desbloqueio realizado" sem fato: corrige sem ferramentas, força concluir_triagem e responde do caminho de conclusão', async () => {
      hasRecentTrustUnlockByContact.mockResolvedValue(false);
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Prontinho, João! O desbloqueio em confiança foi realizado.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'João, não consegui liberar o acesso agora; a equipe confere a partir das 08:00.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"comprovante","confianca":0.9}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Registrado, João. A equipe dá continuidade a partir das 08:00.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });

      // Exatamente quatro: afirmação → correção → conclusão → texto final.
      expect(createChatCompletion).toHaveBeenCalledTimes(4);
      // A correção sai sem ferramentas e com a ordem explícita.
      const correcao = createChatCompletion.mock.calls[1][0];
      expect(correcao.tools).toEqual([]);
      expect(correcao.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringMatching(/afirmou uma liberação que NÃO aconteceu/) }),
      ]));
      // O turno não termina nela: a conclusão é exigida em seguida.
      expect(createChatCompletion.mock.calls[2][0].toolChoice).toBe('concluir_triagem');
      expect(executeTool).toHaveBeenCalledWith('concluir_triagem', expect.objectContaining({ resumo: 'comprovante' }), expect.anything());
      expect(r.texto).toBe('Registrado, João. A equipe dá continuidade a partir das 08:00.');
      expect(r.erro).toBeFalsy();
    });

    test('com a triagem já concluída, o texto corrigido sai direto', async () => {
      hasRecentTrustUnlockByContact.mockResolvedValue(false);
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'O desbloqueio em confiança foi realizado.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'João, não consegui liberar o acesso agora; a equipe confere a partir das 08:00.' }, usage: {} });
      executeTool.mockImplementation(async (nome, args, contexto) => {
        contexto.triagemConcluida = { setor: 'Financeiro' };
        return { ok: true, resultado: { concluido: true } };
      });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });

      expect(createChatCompletion).toHaveBeenCalledTimes(3);
      expect(r.texto).toBe('João, não consegui liberar o acesso agora; a equipe confere a partir das 08:00.');
    });

    // O worker precisa saber que a liberação aconteceu DE VERDADE neste turno:
    // é o que o autoriza a mandar a frase de sucesso por código quando o turno
    // estoura o tempo antes de o modelo escrever qualquer coisa.
    test('o turno devolve desbloqueioRealizado quando a ferramenta marcou o contexto', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'desbloqueio_confianca', arguments: '{"contratoId":26515}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Prontinho, João! O desbloqueio em confiança foi realizado.' }, usage: {} });
      executeTool.mockImplementation(async (nome, args, contexto) => {
        contexto.desbloqueioRealizado = true;
        return { ok: true, resultado: { liberado: true, dias: 3 } };
      });
      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });
      expect(r.desbloqueioRealizado).toBe(true);
    });

    test('sem liberação no turno, desbloqueioRealizado sai false (nunca undefined)', async () => {
      createChatCompletion.mockResolvedValueOnce({ message: { content: 'Me manda o comprovante, João.' }, usage: {} });
      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });
      expect(r.desbloqueioRealizado).toBe(false);
    });

    test('"já deixei na fila" sem conclusão força concluir_triagem', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Já deixei seu atendimento na fila com o comprovante.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Registrado, João.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });
      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });
      expect(createChatCompletion.mock.calls[1][0].toolChoice).toBe('concluir_triagem');
    });
  });

  test('encerrar_atendimento entra na lista fixa da triagem', async () => {
    expect(FERRAMENTAS_TRIAGEM).toContain('encerrar_atendimento');
    expect(FERRAMENTAS_TRIAGEM).toHaveLength(10);
  });

  // 2N chamadas (status do contrato + da conexão de cada contrato) estouravam
  // o teto do turno no cliente com vários contratos: o Suporte precisa da
  // versão de uma chamada só.
  test('consultar_status_todos_contratos entra na lista fixa da triagem', async () => {
    expect(FERRAMENTAS_TRIAGEM).toContain('consultar_status_todos_contratos');
  });

  test('devolve atendimentoEncerrado quando o turno encerrou o atendimento', async () => {
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'encerrar_atendimento', arguments: '{}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Até logo, João!' }, usage: {} });
    executeTool.mockImplementation(async (nome, args, ctx) => { ctx.atendimentoEncerrado = true; return { ok: true, resultado: { encerrado: true } }; });
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM });
    expect(r.atendimentoEncerrado).toBe(true);
  });

  test('turno comum devolve atendimentoEncerrado false', async () => {
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM });
    expect(r.atendimentoEncerrado).toBe(false);
  });

  test('devolve triagemConcluida e a identidade final, e grava mode triage na auditoria', async () => {
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Perfeito, João — o Financeiro continua daqui.' }, usage: {} });
    executeTool.mockImplementation(async (nome, args, ctx) => { ctx.triagemConcluida = { setor: 'Financeiro' }; return { ok: true, resultado: { concluido: true } }; });
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM });
    expect(r.triagemConcluida).toEqual({ setor: 'Financeiro' });
    expect(r.identidade.nivel).toBe('forte');
    expect(recordAiInteraction).toHaveBeenCalledWith(expect.objectContaining({ mode: 'triage' }));
  });

  // Task 6: o escopo do terceiro (boleto de outra pessoa) entra pelo mesmo
  // parâmetro que a identidade e sai pelo mesmo caminho no retorno — quem
  // persiste de verdade é a própria ferramenta (tool-registry.js), não o
  // orquestrador; aqui só provamos a passagem contexto ida e volta.
  test('recebe terceiro e o coloca no contexto do turno', async () => {
    let ctxVisto;
    executeTool.mockImplementation(async (nome, args, ctx) => { ctxVisto = ctx; return { ok: true, resultado: {} }; });
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'esquecer_identificacao', arguments: '{}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'ok' }, usage: {} });
    const escopo = { nome: 'Maria', contratos: [{ id: 77 }] };
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM, terceiro: escopo });
    expect(ctxVisto.terceiro).toEqual(escopo);
  });

  test('sem terceiro informado, o contexto do turno nasce com null', async () => {
    let ctxVisto;
    executeTool.mockImplementation(async (nome, args, ctx) => { ctxVisto = ctx; return { ok: true, resultado: {} }; });
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'esquecer_identificacao', arguments: '{}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'ok' }, usage: {} });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM });
    expect(ctxVisto.terceiro).toBeNull();
  });

  test('devolve terceiro no retorno do turno, refletindo o que a ferramenta deixou no contexto', async () => {
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'buscar_cliente', arguments: '{"cpf":"52998224725","titularEOutraPessoa":true}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Localizei o contrato.' }, usage: {} });
    const escopo = { nome: 'Maria', contratos: [{ id: 77 }] };
    executeTool.mockImplementation(async (nome, args, ctx) => { ctx.terceiro = escopo; return { ok: true, resultado: {} }; });
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: TRIAGEM });
    expect(r.terceiro).toEqual(escopo);
  });

  test('perfil assistente continua igual: sem identidade, ferramentas do cartão', async () => {
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    const req = createChatCompletion.mock.calls[0][0];
    expect(req.tools.map((t) => t.function.name)).toEqual(['desbloqueio_confianca']);
    expect(req.messages[0].content).not.toMatch(/recepcionista/i);
  });
});

// Threading do messageId (idempotência de enviar_boleto/gerar_pix). O que
// importa não é só o repasse: é que o MESMO id chegue a todas as tool calls do
// turno e a todas as voltas internas do laço. Um id por tool call, ou por
// chamada à OpenAI, anularia a guarda de reenvio inteira.
describe('messageId no contexto do turno', () => {
  const IDENTIDADE = {
    nivel: 'forte', origem: 'phone', primeiroNome: 'João', nome: 'João Da Silva Pereira',
    contracts: [{ id: 17402, statusCode: 1, plan: '600MB', address: 'RUA X' }],
    client: { id: 9, document: '11122233344' }, contestado: false,
  };
  const TRIAGEM_LOCAL = { threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false };

  beforeEach(() => {
    getAiConfig.mockResolvedValue({
      apiKey: 'sk', model: 'gpt-x', mode: 'triage', systemPrompt: 'Você é a assistente.',
      maxToolsPerInteraction: 8, triageExtraInstructions: 'Seja breve.',
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null,
    });
    createChatCompletion.mockReset();
  });

  const turno = (extra = {}) => runAiTurn({
    conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem',
    identidade: IDENTIDADE, triagem: TRIAGEM_LOCAL, origemMensagem: 'texto', ...extra,
  });

  test('o messageId do turno chega ao contexto das ferramentas', async () => {
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Enviei acima o boleto.' }, usage: {} });
    let ctxVisto;
    executeTool.mockImplementation(async (nome, args, ctx) => { ctxVisto = ctx; return { ok: true, resultado: { enviado: true } }; });
    await turno({ messageId: 'msg-42' });
    expect(ctxVisto.messageId).toBe('msg-42');
  });

  test('duas tool calls do mesmo turno recebem o MESMO messageId', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [
            { id: 't1', function: { name: 'consultar_status_contrato', arguments: '{"contratoId":17402}' } },
            { id: 't2', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } },
          ],
        },
        usage: {},
      })
      .mockResolvedValueOnce({ message: { content: 'Enviei acima o boleto.' }, usage: {} });
    const vistos = [];
    executeTool.mockImplementation(async (nome, args, ctx) => {
      vistos.push(ctx.messageId);
      return { ok: true, resultado: { enviado: true } };
    });
    await turno({ messageId: 'msg-42' });
    expect(vistos).toEqual(['msg-42', 'msg-42']);
  });

  test('voltas seguidas do laço (três chamadas à OpenAI) mantêm o mesmo messageId', async () => {
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'consultar_status_contrato', arguments: '{"contratoId":17402}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't2', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Tudo certo por aqui.' }, usage: {} });
    const vistos = [];
    executeTool.mockImplementation(async (nome, args, ctx) => {
      vistos.push(ctx.messageId);
      return { ok: true, resultado: { enviado: true } };
    });
    await turno({ messageId: 'msg-42' });
    expect(vistos).toEqual(['msg-42', 'msg-42']);
    expect(createChatCompletion).toHaveBeenCalledTimes(3);
  });

  // Sem messageId o contexto carrega null — nunca um valor inventado: em
  // tool-registry.js é isso que faz o reenvio falhar FECHADO.
  test('sem messageId, o contexto carrega null (falha fechado)', async () => {
    createChatCompletion
      .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'enviar_boleto', arguments: '{"contratoId":17402}' } }] }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Enviei acima o boleto.' }, usage: {} });
    let ctxVisto;
    executeTool.mockImplementation(async (nome, args, ctx) => { ctxVisto = ctx; return { ok: true, resultado: { enviado: true } }; });
    await turno();
    expect(ctxVisto.messageId).toBeNull();
  });
});
