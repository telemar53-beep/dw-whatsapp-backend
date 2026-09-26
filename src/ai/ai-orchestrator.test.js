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
      expect(sys).toContain('AVISO ATIVO PARA Cândido Mendes: Rompimento de fibra; equipe em campo.');
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
    // 12 desde 2026-09-22, com as duas comerciais; 13 desde 2026-09-25, com
    // conferir_pagamento (regra 0/1/2+). A contagem existe para ferramenta
    // nova não entrar na triagem sem ninguém decidir.
    expect(FERRAMENTAS_TRIAGEM).toHaveLength(13);
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

// Contenção de 2026-09-22 — prova de FIAÇÃO, não de unidade. O gate de
// aprovação humana vive no tool-executor, mas só atua se o orquestrador
// DECLARAR o perfil no contexto. Sem estes testes, apagar `perfil:
// 'assistente'` da linha do contexto passaria por todo o resto da suíte e o
// buraco voltaria inteiro: a suíte do executor continuaria verde, porque lá o
// perfil é montado à mão no teste.
describe('ai-orchestrator — o perfil vai declarado no contexto', () => {
  test('perfil assistente chega ao executor marcado como assistente', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'desbloqueio_confianca', arguments: '{"contratoId":19631}' } }] },
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Dá para liberar o acesso dela; confirma?' },
        usage: { promptTokens: 1, completionTokens: 1 },
      });
    executeTool.mockResolvedValue({ ok: false, motivo: 'action_requires_human_approval', detalhe: null, instrucao: 'peça à atendente' });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(executeTool).toHaveBeenCalledWith(
      'desbloqueio_confianca',
      expect.anything(),
      expect.objectContaining({ perfil: 'assistente' })
    );
  });

  test('perfil triagem chega ao executor marcado como triagem', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'consultar_plano', arguments: '{}' } }] },
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Certo!' },
        usage: { promptTokens: 1, completionTokens: 1 },
      });
    executeTool.mockResolvedValue({ ok: true, resultado: {} });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false } });

    expect(executeTool).toHaveBeenCalledWith(
      'consultar_plano',
      expect.anything(),
      expect.objectContaining({ perfil: 'triagem' })
    );
  });

  // A tentativa recusada não pode morrer dentro do turno: é ela que o worker
  // usa para deixar a ação visível para a atendente.
  test('a recusa de aprovação humana volta em toolsRecusadas', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'desbloqueio_confianca', arguments: '{}' } }] },
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'ok' },
        usage: { promptTokens: 1, completionTokens: 1 },
      });
    executeTool.mockResolvedValue({ ok: false, motivo: 'action_requires_human_approval', detalhe: null, instrucao: 'x' });

    const turno = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(turno.toolsRecusadas).toEqual([
      expect.objectContaining({ nome: 'desbloqueio_confianca', motivo: 'action_requires_human_approval' }),
    ]);
    expect(turno.toolsExecutadas).toEqual([]);
  });

  // A `instrucao` da recusa é o único texto que diz ao modelo "isso NÃO
  // aconteceu". Se ela não chegar na mensagem role:'tool', o modelo continua
  // livre para escrever "já liberei" — que é exatamente o que aconteceu em
  // produção, só que lá a liberação tinha acontecido mesmo.
  test('a instrução da recusa chega ao modelo na volta seguinte', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'desbloqueio_confianca', arguments: '{}' } }] },
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'ok' },
        usage: { promptTokens: 1, completionTokens: 1 },
      });
    executeTool.mockResolvedValue({ ok: false, motivo: 'action_requires_human_approval', detalhe: null, instrucao: 'NÃO diga que fez' });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const segundaChamada = createChatCompletion.mock.calls[1][0];
    const msgTool = segundaChamada.messages.find((m) => m.role === 'tool' && m.tool_call_id === 't1');
    expect(JSON.parse(msgTool.content)).toEqual({
      erro: 'action_requires_human_approval',
      instrucao: 'NÃO diga que fez',
    });
  });
});

// Fase 1B (25/09/2026): disparo automático como fato. O texto montado do disparo (nome, valor,
// link) fica no registro para a atendente, mas NUNCA entra cru no que vai à IA — nos DOIS perfis.
describe('Fase 1B — disparo automático no histórico da IA', () => {
  const { findMessageById } = require('../conversations/message.repository');
  const CORPO = 'Olá, {{1}}! Sua fatura da DW Telecom está disponível.\n\nValor: {{2}}\nVencimento: {{3}}\nBoleto: {{4}}';
  const MONTADO = 'Olá, Maria! Sua fatura da DW Telecom está disponível.\n\nValor: R$ 100,00\nVencimento: 30/09/2026\nBoleto: https://boleto.exemplo/abc123';
  const disparo = (id, template, extra = {}) => ({
    id, direction: 'outbound', sentBy: 'human', messageType: 'text', content: MONTADO, createdAt: new Date(Date.now() - 2 * 60000),
    metadata: { origem: 'sgp', gatewayId: 'gw', modo: 'template', template, textoModelo: CORPO, tipo: 'desconhecido', ...extra },
  });
  const resposta = (repliedToMessageId = null) => ({
    id: 'in-1', direction: 'inbound', messageType: 'text', content: 'não sei do que é, não estou atrasado, pago dia 30', repliedToMessageId, createdAt: new Date(),
  });
  const IDENT_NONE = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
  const TRIAGEM_1B = { threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false };
  const PROIBIDOS = ['Maria', 'R$ 100,00', '100,00', 'https://', 'boleto.exemplo'];

  beforeEach(() => {
    createChatCompletion.mockReset();
    createChatCompletion.mockResolvedValue({ message: { content: 'Essa mensagem foi um aviso automático da sua fatura.' }, usage: {} });
    findMessageById.mockResolvedValue(null);
  });

  async function pedido(perfil, historico) {
    listRecentMessagesByConversation.mockResolvedValue(historico);
    const base = { conversation: CONVERSATION, contact: CONTACT };
    await runAiTurn(perfil === 'triagem'
      ? { ...base, perfil: 'triagem', identidade: IDENT_NONE, triagem: TRIAGEM_1B, origemMensagem: 'texto' }
      : base);
    return createChatCompletion.mock.calls[0][0];
  }

  test.each(['triagem', 'assistente'])('E. privacidade (%s): nem nome, nem valor, nem link chegam à IA', async (perfil) => {
    const req = await pedido(perfil, [disparo('d-1', 'dw_fatura_mensal'), resposta()]);
    const tudo = JSON.stringify(req.messages);
    for (const proibido of PROIBIDOS) expect(tudo).not.toContain(proibido);
    // O disparo aparece como resumo seguro, com o texto do MODELO.
    expect(tudo).toContain('mensagem automática do SGP enviada ao cliente');
    expect(tudo).toContain('{{1}}');
  });

  // Campanha: a tela e o banco guardam o texto real; ao modelo vai só o rótulo controlado.
  const CAMPANHA_RENDERIZADA = 'Olá Maria! Sua fatura de R$ 99,90 está disponível: https://boleto.exemplo/campanha/abc123';
  const PROIBIDOS_CAMPANHA = ['Maria', 'R$ 99,90', '99,90', 'https://', 'boleto.exemplo'];
  const campanha = (id, template) => ({
    id, direction: 'outbound', sentBy: 'human', messageType: 'text', content: CAMPANHA_RENDERIZADA, createdAt: new Date(Date.now() - 2 * 60000),
    metadata: { origem: 'campanha', campanhaId: 'c-1', ...(template ? { template } : {}) },
  });

  test.each([
    ['triagem', 'promo'], ['assistente', 'promo'], ['triagem', null], ['assistente', null],
  ])('E. privacidade da campanha (%s, template %s): nem nome, nem valor, nem link chegam à IA', async (perfil, template) => {
    const req = await pedido(perfil, [campanha('c-msg', template), resposta()]);
    const tudo = JSON.stringify(req.messages);
    for (const proibido of PROIBIDOS_CAMPANHA) expect(tudo).not.toContain(proibido);
    expect(tudo).toContain('mensagem automática de campanha enviada ao cliente');
    expect(tudo).toContain('conteúdo omitido');
  });

  test.each(['triagem', 'assistente'])('F. contexto (%s): o fato do disparo entra no prompt do sistema', async (perfil) => {
    const req = await pedido(perfil, [disparo('d-1', 'dw_fatura_mensal'), resposta()]);
    const sistema = req.messages[0].content;
    expect(sistema).toMatch(/MENSAGEM AUTOMÁTICA RECENTE/);
    expect(sistema).toContain('dw_fatura_mensal');
    expect(sistema).toMatch(/não presuma a finalidade/);
    expect(sistema).toMatch(/Se ele mudou de assunto, siga o assunto novo/);
  });

  test('F. o disparo citado pelo cliente tem prioridade sobre o último', async () => {
    const req = await pedido('triagem', [disparo('d-a', 'tpl_citado'), disparo('d-b', 'tpl_ultimo'), resposta('d-a')]);
    const sistema = req.messages[0].content;
    expect(sistema).toContain('tpl_citado');
    expect(sistema).not.toContain('tpl_ultimo');
    expect(sistema).toContain('citando');
  });

  // Fase 1C (25/09/2026): disparo → autorresposta do estabelecimento (marcada) → fala humana. A IA
  // sabe das duas primeiras, mas a autorresposta vai como rótulo, nunca como fala do cliente, e
  // a proteção da 1B continua (nada do texto montado do disparo).
  test.each(['triagem', 'assistente'])('19. autorresposta marcada chega à IA como rótulo, sem o texto (%s)', async (perfil) => {
    const autorresposta = {
      id: 'ar-1', direction: 'inbound', messageType: 'text', content: 'Restaurante Sabor Caseiro agradece seu contato. Como podemos ajudar?',
      metadata: { autorrespostaProvavel: true, autorrespostaMotivo: 'janela_padrao_forte' }, createdAt: new Date(Date.now() - 60000),
    };
    const req = await pedido(perfil, [disparo('d-1', 'dw_fatura_mensal'), autorresposta, { ...resposta(), content: 'que mensagem é essa?' }]);
    const tudo = JSON.stringify(req.messages);
    expect(tudo).toContain('resposta automática provável do estabelecimento destinatário');
    expect(tudo).not.toContain('Sabor Caseiro');
    expect(tudo).not.toContain('Como podemos ajudar');
    for (const proibido of PROIBIDOS) expect(tudo).not.toContain(proibido);
    expect(tudo).toContain('mensagem automática do SGP enviada ao cliente');
  });

  test('F. citação a um disparo fora das 20 mensagens carregadas: busca a citada', async () => {
    findMessageById.mockResolvedValue(disparo('d-velho', 'tpl_velho'));
    const req = await pedido('triagem', [disparo('d-b', 'tpl_ultimo'), resposta('d-velho')]);
    expect(findMessageById).toHaveBeenCalledWith('d-velho');
    expect(req.messages[0].content).toContain('tpl_velho');
  });

  test('F. sem citação: o último disparo automático', async () => {
    const req = await pedido('triagem', [disparo('d-a', 'tpl_antigo'), disparo('d-b', 'tpl_ultimo'), resposta()]);
    expect(req.messages[0].content).toContain('tpl_ultimo');
  });

  test.each(['triagem', 'assistente'])('F. sem disparo (%s): nenhum fato é criado', async (perfil) => {
    const req = await pedido(perfil, [resposta()]);
    expect(req.messages[0].content).not.toMatch(/MENSAGEM AUTOMÁTICA RECENTE/);
  });

  test('F. tipo desconhecido não vira cobrança vencida', async () => {
    const req = await pedido('triagem', [disparo('d-1', 'dw_fatura_mensal'), resposta()]);
    expect(req.messages[0].content).not.toMatch(/cobrança vencida|está em atraso/i);
  });

  test('mensagem que NÃO é automática continua indo ao modelo como sempre', async () => {
    const humana = { id: 'h-1', direction: 'outbound', sentBy: 'human', messageType: 'text', content: 'Olá, sou a Ana, do atendimento.', metadata: null };
    const req = await pedido('triagem', [humana, resposta()]);
    expect(JSON.stringify(req.messages)).toContain('Olá, sou a Ana, do atendimento.');
  });
});

// Aviso de cidade como FATO operacional (25/09/2026). Caso auditado: o prompt do turno era montado
// antes de buscar_cliente descobrir a cidade; a resposta final saía sem a falha regional, e o
// roteiro individual (reiniciar, teste de velocidade) atropelava o aviso.
describe('aviso de cidade como fato do turno', () => {
  const { respostaSeguraDoAviso } = require('./regional-outage');
  const { executeTool } = require('./tool-executor');
  const { recordAiInteraction } = require('./ai-interaction.repository');
  const FATO = { cidade: 'Maracaçumé', mensagem: 'Instabilidade na rede da cidade.', desde: '2026-09-25T12:00:00.000Z', impacto: null };
  const IDENT = { nivel: 'forte', origem: 'phone', primeiroNome: 'Maria', contracts: [{ id: 5, statusCode: 1, address: 'RUA X' }], client: { id: 9, document: '11122233344' }, contestado: false };
  const SEM_IDENT = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
  const TRIAGEM_AV = { threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false };
  const entrada = (content) => ({ id: 'in-1', direction: 'inbound', messageType: 'text', content, createdAt: new Date() });
  const chamada = (nome) => ({ message: { content: null, tool_calls: [{ id: 't-' + nome, type: 'function', function: { name: nome, arguments: '{}' } }] }, usage: {} });
  const final = (content) => ({ message: { content }, usage: {} });

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-2', name: 'Suporte', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Sem conexão' }]);
    createChatCompletion.mockReset();
    executeTool.mockReset();
    listRecentMessagesByConversation.mockResolvedValue([entrada('boa tarde, estou sem internet')]);
  });

  const turno = (extra = {}) => runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT, triagem: TRIAGEM_AV, origemMensagem: 'texto', ...extra });

  test('1. cliente já identificado + aviso ativo + "sem internet": o fato chega ao prompt E ao contexto das ferramentas', async () => {
    createChatCompletion.mockResolvedValueOnce(chamada('consultar_status_todos_contratos')).mockResolvedValueOnce(final('Há uma ocorrência na rede em Maracaçumé.'));
    executeTool.mockResolvedValue({ ok: true, resultado: {} });

    await turno({ avisoCidade: FATO });

    expect(createChatCompletion.mock.calls[0][0].messages[0].content).toContain('AVISO ATIVO PARA Maracaçumé');
    expect(executeTool.mock.calls[0][2].avisoCidade).toEqual(FATO);
  });

  test('2. cidade só descoberta por buscar_cliente NO MESMO TURNO: a resposta final já é gerada com o aviso no prompt', async () => {
    createChatCompletion.mockResolvedValueOnce(chamada('buscar_cliente')).mockResolvedValueOnce(final('Há uma ocorrência na rede em Maracaçumé.'));
    // O que o buscar_cliente de verdade faz (tool-registry.test: "aviso de cidade como fato do turno").
    executeTool.mockImplementation(async (_nome, _args, ctx) => {
      ctx.avisoCidade = FATO;
      return { ok: true, resultado: { cliente: { nome: 'Maria' }, avisoAtivo: { local: 'Maracaçumé', mensagem: FATO.mensagem } } };
    });

    // O mock guarda a REFERÊNCIA de `messages`; o prompt de sistema de cada chamada é copiado na hora.
    const sistemaPorChamada = [];
    const respostas = [chamada('buscar_cliente'), final('Há uma ocorrência na rede em Maracaçumé.')];
    createChatCompletion.mockReset().mockImplementation(async ({ messages }) => {
      sistemaPorChamada.push(messages[0].content);
      return respostas.shift();
    });

    await turno({ identidade: SEM_IDENT });

    expect(sistemaPorChamada).toHaveLength(2);
    expect(sistemaPorChamada[0]).not.toContain('AVISO ATIVO');
    expect(sistemaPorChamada[1]).toContain('AVISO ATIVO PARA Maracaçumé: Instabilidade na rede da cidade.');
  });

  test('3/12. aviso ativo + reclamação de conexão: resposta que manda reiniciar/testar é trocada pela resposta segura', async () => {
    createChatCompletion.mockResolvedValueOnce(final('Reinicie o roteador e faça um teste de velocidade, por favor.'));

    const r = await turno({ avisoCidade: FATO });

    expect(r.texto).toBe(respostaSeguraDoAviso(FATO));
    expect(recordAiInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ finalResponse: respostaSeguraDoAviso(FATO) }));
  });

  test('3/12b. aviso descoberto no meio do turno também trava o roteiro individual da resposta final', async () => {
    createChatCompletion.mockResolvedValueOnce(chamada('buscar_cliente')).mockResolvedValueOnce(final('Desligue a ONU da tomada por 30 segundos.'));
    executeTool.mockImplementation(async (_n, _a, ctx) => { ctx.avisoCidade = FATO; return { ok: true, resultado: {} }; });

    const r = await turno({ identidade: SEM_IDENT });

    expect(r.texto).toBe(respostaSeguraDoAviso(FATO));
  });

  test('8. aviso sem prazo: resposta que inventa previsão é trocada', async () => {
    createChatCompletion.mockResolvedValueOnce(final('Há uma falha na região, deve normalizar em 2 horas.'));
    const r = await turno({ avisoCidade: FATO });
    expect(r.texto).toBe(respostaSeguraDoAviso(FATO));
  });

  test('resposta que só informa a ocorrência passa intacta (a trava não reescreve à toa)', async () => {
    createChatCompletion.mockResolvedValueOnce(final('Há uma ocorrência na rede em Maracaçumé que pode estar afetando sua conexão.'));
    const r = await turno({ avisoCidade: FATO });
    expect(r.texto).toBe('Há uma ocorrência na rede em Maracaçumé que pode estar afetando sua conexão.');
  });

  test('4. sem aviso ativo: o roteiro individual normal passa como está', async () => {
    createChatCompletion.mockResolvedValueOnce(final('Reinicie o roteador e me avise.'));
    const r = await turno({ avisoCidade: null });
    expect(r.texto).toBe('Reinicie o roteador e me avise.');
  });

  // Contenções operacionais (25/09/2026): a resposta de exemplo deste teste era "Verifique o cabo
  // de rede e me mande uma foto do roteador." — com equipamento queimado, conferir cabo é o roteiro
  // comum que a regra A agora barra (ver 'contenções operacionais', mais abaixo). O que este teste
  // prova continua o mesmo: o aviso não troca a resposta sobre o equipamento pela da ocorrência.
  test('não generaliza: com aviso ativo mas equipamento queimado, o tratamento do equipamento segue', async () => {
    listRecentMessagesByConversation.mockResolvedValue([entrada('caiu um raio e meu roteador queimou, estou sem internet')]);
    createChatCompletion.mockResolvedValueOnce(final('Entendi, o roteador queimou com o raio. Me mande uma foto dele, por favor.'));
    const r = await turno({ avisoCidade: FATO });
    expect(r.texto).toBe('Entendi, o roteador queimou com o raio. Me mande uma foto dele, por favor.');
  });

  // Um aviso por turno (25/09/2026): quando o aviso JÁ FOI ENVIADO ao cliente neste turno, a
  // contenção continua vencendo, mas a ocorrência não é repetida numa segunda mensagem.
  describe('aviso já enviado neste turno: sem repetir a ocorrência', () => {
    const ENVIADO = { ...FATO, enviadoNesteTurno: true };
    const MINIMA = 'Não é necessário fazer nenhum teste no seu equipamento agora.';

    test('2. buscar_cliente descobre E envia o aviso no mesmo turno + modelo manda reiniciar: resposta mínima, sem repetir a ocorrência', async () => {
      const sistemaPorChamada = [];
      const respostas = [chamada('buscar_cliente'), final('Reinicie o roteador, por favor.')];
      createChatCompletion.mockReset().mockImplementation(async ({ messages }) => {
        sistemaPorChamada.push(messages[0].content);
        return respostas.shift();
      });
      executeTool.mockImplementation(async (_n, _a, ctx) => { ctx.avisoCidade = { ...ENVIADO }; return { ok: true, resultado: {} }; });

      const r = await turno({ identidade: SEM_IDENT });

      expect(r.texto).toBe(MINIMA);
      expect(r.texto).not.toMatch(/ocorr[eê]ncia/);
      // O fato continua no prompt recomposto, com a ordem de não repetir.
      expect(sistemaPorChamada[1]).toContain('AVISO ATIVO PARA Maracaçumé');
      expect(sistemaPorChamada[1]).toContain('JÁ FOI ENVIADO ao cliente agora');
    });

    test('3. aviso enviado neste turno + modelo inventa prazo: prazo sai, ocorrência não é repetida', async () => {
      createChatCompletion.mockResolvedValueOnce(final('Deve normalizar em 2 horas.'));
      const r = await turno({ avisoCidade: ENVIADO });
      expect(r.texto).toBe(MINIMA);
    });

    test('4. aviso enviado neste turno + "equipe já está resolvendo" sem esse fato: a afirmação sai, ocorrência não é repetida', async () => {
      createChatCompletion.mockResolvedValueOnce(final('Nossa equipe já está trabalhando nisso.'));
      const r = await turno({ avisoCidade: ENVIADO });
      expect(r.texto).toBe(MINIMA);
    });

    test('aviso mandado pelo worker (ou na entrada desta mensagem) conta igual: resposta mínima', async () => {
      createChatCompletion.mockResolvedValueOnce(final('Faça um teste de velocidade.'));
      const r = await turno({ avisoCidade: ENVIADO });
      expect(r.texto).toBe(MINIMA);
    });

    test('1/6. aviso ativo mas NÃO enviado neste turno: a resposta segura completa continua informando a ocorrência', async () => {
      createChatCompletion.mockResolvedValueOnce(final('Reinicie o roteador.'));
      const r = await turno({ avisoCidade: FATO });
      expect(r.texto).toMatch(/ocorrência registrada pela nossa equipe na rede em Maracaçumé/);
      expect(r.texto).toMatch(/Não é preciso fazer nenhum teste/);
    });

    test('aviso enviado neste turno + resposta que não contradiz: passa intacta', async () => {
      createChatCompletion.mockResolvedValueOnce(final('Entendi! Vou deixar seu atendimento registrado para o suporte.'));
      const r = await turno({ avisoCidade: ENVIADO });
      expect(r.texto).toBe('Entendi! Vou deixar seu atendimento registrado para o suporte.');
    });
  });

  test('10. modo Assistente: sem trava e sem mudança', async () => {
    listToolPermissions.mockResolvedValue([]);
    createChatCompletion.mockResolvedValueOnce(final('Sugestão: peça para reiniciar o roteador.'));
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, avisoCidade: FATO });
    expect(r.texto).toBe('Sugestão: peça para reiniciar o roteador.');
  });
});

// Contenções operacionais (25/09/2026): equipamento com defeito físico, troca de nome/senha do
// Wi-Fi e explicação financeira sem fonte oficial. O código lê o sinal na fala do cliente, corrige
// o modelo UMA vez dentro do laço (exigindo a conclusão quando o próximo passo não depende de
// perguntar nada) e, se ele insistir, troca a resposta final pela segura. Sem OpenAI real: toda
// resposta do modelo é roteirizada. Documentos e senhas são sintéticos.
describe('contenções operacionais: equipamento físico, Wi-Fi e explicação financeira', () => {
  const { respostaSeguraDoAviso } = require('./regional-outage');
  const { executeTool } = require('./tool-executor');
  const FATO = { cidade: 'Maracaçumé', mensagem: 'Instabilidade na rede da cidade.', desde: '2026-09-25T12:00:00.000Z', impacto: null };
  const IDENT = { nivel: 'forte', origem: 'phone', primeiroNome: 'Maria', contracts: [{ id: 5, statusCode: 1, address: 'RUA X' }], client: { id: 9, document: '11122233344' }, contestado: false };
  const SEM_IDENT = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
  const TERCEIRO = { nome: 'Beltrana', contratos: [{ id: 77 }] };
  const DIA = { threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false, noturno: { ativo: false } };
  const NOITE = { ...DIA, noturno: { ativo: true, retornoAs: '08:00' } };
  const entrada = (content) => ({ id: `in-${content.length}`, direction: 'inbound', messageType: 'text', content, createdAt: new Date() });
  const saida = (content) => ({ id: 'out-1', direction: 'outbound', messageType: 'text', content, sentBy: 'ai', createdAt: new Date() });
  const chamada = (nome) => ({ message: { content: null, tool_calls: [{ id: 't-' + nome, type: 'function', function: { name: nome, arguments: '{}' } }] }, usage: {} });
  const final = (content) => ({ message: { content }, usage: {} });

  // O mock guarda a REFERÊNCIA de `messages`: o que cada chamada viu é copiado na hora.
  let vistas;
  function roteiro(...respostas) {
    vistas = [];
    createChatCompletion.mockReset().mockImplementation(async ({ messages, toolChoice }) => {
      vistas.push({ sistema: messages[0].content, ultima: messages[messages.length - 1], toolChoice });
      return respostas.shift();
    });
  }
  // As ferramentas de verdade estão em tool-registry.test; aqui, só o efeito que o turno lê.
  function ferramentas({ setor = 'Suporte', resultados = {} } = {}) {
    executeTool.mockReset().mockImplementation(async (nome, _args, ctx) => {
      if (nome === 'concluir_triagem') {
        ctx.triagemConcluida = { setor };
        return { ok: true, resultado: { concluido: true, setor, instrucao: 'Responda ao cliente em uma frase.' } };
      }
      if (nome === 'gerar_pix' || nome === 'enviar_boleto') ctx.resolvidoPelaIa = true;
      return { ok: true, resultado: resultados[nome] || {} };
    });
  }

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-2', name: 'Suporte', aiHint: '' }, { id: 's-3', name: 'Financeiro', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Sem conexão' }]);
    ferramentas();
  });

  const turno = (historico, extra = {}) => {
    listRecentMessagesByConversation.mockResolvedValue(historico.map((m) => (typeof m === 'string' ? entrada(m) : m)));
    return runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT, triagem: DIA, origemMensagem: 'texto', ...extra });
  };

  describe('A — equipamento com defeito físico', () => {
    const SEGURA_DIA = 'Entendi. Não mexa no equipamento nem tente consertar. Seu atendimento vai para o setor Suporte e um atendente continua daqui.';

    test('1. "meu roteador queimou": o reinício e o teste de velocidade são barrados e o código exige a conclusão para o suporte', async () => {
      roteiro(
        final('Reinicie o roteador e faça um teste de velocidade.'),
        chamada('concluir_triagem'),
        final('Entendi, o roteador queimou. Registrei para o setor Suporte; um atendente continua daqui.'),
      );
      const r = await turno(['meu roteador queimou']);
      expect(vistas[0].sistema).toContain('DEFEITO FÍSICO NO EQUIPAMENTO');
      expect(vistas[1].ultima.role).toBe('system');
      expect(vistas[1].ultima.content).toMatch(/DEFEITO FÍSICO/);
      expect(vistas[1].toolChoice).toBe('concluir_triagem');
      expect(r.triagemConcluida).toEqual({ setor: 'Suporte' });
      expect(r.texto).toBe('Entendi, o roteador queimou. Registrei para o setor Suporte; um atendente continua daqui.');
    });

    test('2. "a ONU não liga" e o modelo insiste em desligar da tomada: sai a resposta segura, já encaminhada', async () => {
      roteiro(
        final('Desligue a ONU da tomada por 30 segundos e ligue de novo.'),
        chamada('concluir_triagem'),
        final('Enquanto isso, desligue a ONU da tomada e ligue de novo.'),
      );
      const r = await turno(['a ONU não liga']);
      expect(r.texto).toBe(SEGURA_DIA);
    });

    test('3. "a fonte queimou": nada de voltagem, tensão ou fonte improvisada', async () => {
      roteiro(
        final('Use uma fonte de outra voltagem ou meça a tensão da tomada.'),
        chamada('concluir_triagem'),
        final('Pode usar outra fonte parecida enquanto isso.'),
      );
      const r = await turno(['a fonte queimou']);
      expect(r.texto).toBe(SEGURA_DIA);
      expect(r.texto).not.toMatch(/voltagem|tens[aã]o|outra fonte/i);
    });

    test('3b. sem identificação: nada de reparo, e só o CPF ou CNPJ antes de encaminhar (sem conclusão forçada)', async () => {
      roteiro(final('Abra a fonte e veja se o fusível queimou.'), final('Abra a fonte e troque o fusível.'));
      const r = await turno(['a fonte queimou'], { identidade: SEM_IDENT });
      expect(vistas[1].toolChoice).toBeUndefined();
      expect(vistas[1].ultima.content).toMatch(/CPF ou CNPJ/);
      expect(r.texto).toBe('Entendi. Não mexa no equipamento nem tente consertar. Para eu encaminhar ao suporte, me informe o CPF ou CNPJ do titular, por favor.');
    });

    test('4. aviso de cidade + "sem internet, a ONU não acende": a resposta sobre o defeito NÃO é trocada pela ocorrência', async () => {
      roteiro(
        chamada('concluir_triagem'),
        final('A luz da ONU está apagada e ela não acende: é defeito no equipamento. Registrei para o setor Suporte, um atendente continua daqui.'),
      );
      const r = await turno(['estou sem internet, a ONU não acende'], { avisoCidade: FATO });
      expect(r.texto).not.toBe(respostaSeguraDoAviso(FATO));
      expect(r.texto).toBe('A luz da ONU está apagada e ela não acende: é defeito no equipamento. Registrei para o setor Suporte, um atendente continua daqui.');
      expect(vistas[0].sistema).toMatch(/O AVISO ATIVO NÃO explica defeito físico/);
    });

    test('4b. aviso de cidade + "meu roteador queimou": atribuir à ocorrência sem encaminhar é barrado', async () => {
      roteiro(
        final('Há uma ocorrência na rede em Maracaçumé, aguarde a normalização.'),
        chamada('concluir_triagem'),
        final('Registrei o defeito do roteador para o setor Suporte; um atendente continua daqui.'),
      );
      const r = await turno(['meu roteador queimou'], { avisoCidade: FATO });
      expect(vistas[1].toolChoice).toBe('concluir_triagem');
      expect(r.texto).toBe('Registrei o defeito do roteador para o setor Suporte; um atendente continua daqui.');
    });

    test('5. "internet está lenta", sem defeito e sem aviso: o diagnóstico normal continua permitido', async () => {
      roteiro(final('Faça um teste de velocidade perto do equipamento, por favor.'));
      const r = await turno(['minha internet está lenta']);
      expect(r.texto).toBe('Faça um teste de velocidade perto do equipamento, por favor.');
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
      expect(vistas[0].sistema).not.toContain('DEFEITO FÍSICO');
    });

    test('6. à noite: o roteiro de desligar da tomada não vale, e o atendimento fica na fila do suporte com a hora de retorno', async () => {
      roteiro(
        final('Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo?'),
        chamada('concluir_triagem'),
        final('Registrei o defeito para o setor Suporte; nossa equipe dá continuidade a partir das 08:00.'),
      );
      const r = await turno(['meu roteador queimou'], { triagem: NOITE });
      expect(vistas[0].sistema).toMatch(/CONEXÃO À NOITE não se aplica/);
      expect(vistas[1].toolChoice).toBe('concluir_triagem');
      expect(r.texto).toBe('Registrei o defeito para o setor Suporte; nossa equipe dá continuidade a partir das 08:00.');
    });

    test('6b. à noite, se o modelo insistir: a resposta segura diz a hora de retorno', async () => {
      roteiro(
        final('Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo?'),
        chamada('concluir_triagem'),
        final('Desligue da tomada e me avise.'),
      );
      const r = await turno(['meu roteador queimou'], { triagem: NOITE });
      expect(r.texto).toBe('Entendi. Não mexa no equipamento nem tente consertar. Seu atendimento ficou registrado para o setor Suporte e nossa equipe dá continuidade a partir das 08:00.');
    });
  });

  describe('B — troca de nome/senha do Wi-Fi', () => {
    test('7. titular identificado pede a troca da senha: a IA pede só a senha nova, sem ensinar o roteador', async () => {
      roteiro(final('Nós fazemos a troca por aqui. Qual senha você quer usar no Wi-Fi?'));
      const r = await turno(['quero mudar a senha do Wi-Fi']);
      expect(r.texto).toBe('Nós fazemos a troca por aqui. Qual senha você quer usar no Wi-Fi?');
      expect(vistas[0].sistema).toMatch(/NUNCA ensine o cliente a entrar no roteador/);
      expect(vistas[0].sistema).toMatch(/Peça só a senha nova/);
    });

    test('7b. com a senha respondida, encaminha para o suporte', async () => {
      roteiro(chamada('concluir_triagem'), final('Pedido registrado para o setor Suporte; um atendente continua daqui.'));
      const r = await turno(['quero mudar a senha do Wi-Fi', saida('Qual senha você quer usar no Wi-Fi?'), 'Casa@2025']);
      expect(vistas[0].sistema).toMatch(/Ele já informou a senha nova: NÃO pergunte de novo/);
      expect(r.triagemConcluida).toEqual({ setor: 'Suporte' });
      expect(r.texto).toBe('Pedido registrado para o setor Suporte; um atendente continua daqui.');
    });

    test('8. a senha nova veio na mesma mensagem: perguntar de novo é barrado e o código exige a conclusão', async () => {
      roteiro(
        final('Certo! Qual é a nova senha que você quer?'),
        chamada('concluir_triagem'),
        final('Pedido de troca da senha registrado para o setor Suporte; um atendente continua daqui.'),
      );
      const r = await turno(['quero mudar a senha do Wi-Fi para Casa@2025']);
      expect(vistas[1].toolChoice).toBe('concluir_triagem');
      expect(r.texto).toBe('Pedido de troca da senha registrado para o setor Suporte; um atendente continua daqui.');
    });

    test('9. "mudar o nome da rede para CASA": a senha não foi pedida, então não é perguntada', async () => {
      roteiro(
        final('Perfeito. E qual senha você quer colocar?'),
        chamada('concluir_triagem'),
        final('Pedido de troca do nome da rede registrado para o setor Suporte; um atendente continua daqui.'),
      );
      const r = await turno(['quero mudar o nome da rede para CASA']);
      expect(vistas[1].toolChoice).toBe('concluir_triagem');
      expect(r.texto).not.toMatch(/senha/i);
    });

    test('10. terceiro pede a troca do Wi-Fi: não coleta, não encaminha, e o escopo de boleto/PIX não autoriza', async () => {
      roteiro(final('Claro! Qual a nova senha?'), final('Qual a nova senha dela?'));
      const r = await turno(['quero mudar a senha do wifi dela'], { identidade: SEM_IDENT, terceiro: TERCEIRO });
      expect(vistas[0].sistema).toMatch(/vale só para boleto e PIX/);
      expect(vistas[1].toolChoice).toBeUndefined();
      expect(r.texto).toBe('A alteração do Wi-Fi só pode ser pedida pelo próprio titular do contrato.');
      expect(r.triagemConcluida).toBeNull();
    });

    test('11. não identificado: identificação normal antes de pedir a senha nova', async () => {
      roteiro(final('Qual a nova senha?'), final('Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.'));
      const r = await turno(['quero trocar a senha do wifi'], { identidade: SEM_IDENT });
      expect(vistas[1].ultima.content).toMatch(/CPF ou CNPJ/);
      expect(r.texto).toBe('Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.');
    });

    test('12. resposta mandando acessar 192.168.x.x: a contenção impede, mesmo se o modelo insistir', async () => {
      roteiro(
        final('Acesse 192.168.0.1 no navegador, entre com usuário admin e troque a senha.'),
        final('Entre no painel do roteador pelo endereço 192.168.0.1.'),
      );
      const r = await turno(['quero trocar a senha do wifi']);
      expect(r.texto).toBe('Nós fazemos essa alteração para você, sem precisar mexer no equipamento. Qual senha você quer usar no Wi-Fi?');
      expect(r.texto).not.toMatch(/192|admin|painel/);
    });

    test('12b. ensinar o painel é barrado mesmo quando o pedido não foi reconhecido ("como troco a senha?")', async () => {
      roteiro(final('Acesse 192.168.1.1 e entre com usuário admin.'), final('Acesse 192.168.1.1.'));
      const r = await turno(['como troco a senha?']);
      expect(r.texto).toBe('Essa alteração é feita pela nossa equipe, sem você precisar mexer no equipamento.');
    });
  });

  describe('C — explicação financeira sem fonte oficial', () => {
    const FATURAS = { faturas: [{ faturaId: 1, valorOriginal: 99.9, vencimentoOriginal: '2026-10-10' }] };
    const SEM_FONTE = 'Não tenho essa informação confirmada no sistema. Seu atendimento vai para o setor Financeiro e um atendente continua daqui.';

    test('13. "por que minha fatura veio esse valor?" sem fonte: a explicação inventada é barrada e vai para o financeiro', async () => {
      ferramentas({ setor: 'Financeiro' });
      roteiro(
        final('Sua fatura veio mais alta porque teve o proporcional da mudança de plano.'),
        chamada('concluir_triagem'),
        final('Não tenho essa informação confirmada no sistema; seu atendimento vai para o setor Financeiro e um atendente continua daqui.'),
      );
      const r = await turno(['por que minha fatura veio esse valor?']);
      expect(vistas[0].sistema).toMatch(/EXPLICAÇÃO FINANCEIRA DO CONTRATO/);
      expect(vistas[1].toolChoice).toBe('concluir_triagem');
      expect(r.texto).toBe('Não tenho essa informação confirmada no sistema; seu atendimento vai para o setor Financeiro e um atendente continua daqui.');
    });

    test('13b. se o modelo insistir na explicação: sai a resposta segura', async () => {
      ferramentas({ setor: 'Financeiro' });
      roteiro(final('Veio mais alto por causa dos juros.'), chamada('concluir_triagem'), final('Veio mais alto por causa dos juros e da multa.'));
      const r = await turno(['por que minha fatura veio esse valor?']);
      expect(r.texto).toBe(SEM_FONTE);
    });

    test('14. "vai vir quanto mês que vem?" sem fonte: nenhum valor previsto', async () => {
      ferramentas({ setor: 'Financeiro' });
      roteiro(final('Mês que vem deve vir R$ 99,90.'), chamada('concluir_triagem'), final('Mês que vem deve vir R$ 99,90.'));
      const r = await turno(['vai vir quanto mês que vem?']);
      expect(r.texto).toBe(SEM_FONTE);
    });

    test('14b. previsão sem número também é previsão', async () => {
      ferramentas({ setor: 'Financeiro' });
      roteiro(final('Mês que vem deve vir o mesmo valor.'), chamada('concluir_triagem'), final('A próxima fatura vai vir igual.'));
      const r = await turno(['vai vir quanto mês que vem?']);
      expect(r.texto).toBe(SEM_FONTE);
    });

    test.each([['Não, não teve proporcional.'], ['Sim, teve proporcional de 10 dias.']])(
      '15. "teve proporcional?" sem dado oficial: nem sim nem não ("%s")', async (resposta) => {
        ferramentas({ setor: 'Financeiro' });
        roteiro(final(resposta), chamada('concluir_triagem'), final(resposta));
        const r = await turno(['teve proporcional?']);
        expect(r.texto).toBe(SEM_FONTE);
        expect(r.texto).not.toMatch(/proporcional/);
      }
    );

    test('16. o SGP devolveu período e valor explícitos: a IA pode usar esse fato', async () => {
      ferramentas({ resultados: { consultar_faturas_todos_contratos: { faturas: [{ valorOriginal: 99.9, vencimentoOriginal: '2026-10-10', periodo: '01/09/2026 a 30/09/2026' }] } } });
      roteiro(
        chamada('consultar_faturas_todos_contratos'),
        final('O período cobrado é de 01/09/2026 a 30/09/2026, no valor de R$ 99,90, com vencimento em 10/10/2026.'),
      );
      const r = await turno(['qual período está sendo cobrado?']);
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(r.texto).toBe('O período cobrado é de 01/09/2026 a 30/09/2026, no valor de R$ 99,90, com vencimento em 10/10/2026.');
    });

    test('16b. configuração explícita do painel também é fonte', async () => {
      getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: 'A primeira fatura é proporcional aos dias de uso.', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null });
      roteiro(final('Pela nossa política, a primeira fatura é proporcional aos dias de uso.'));
      const r = await turno(['teve proporcional?']);
      expect(r.texto).toBe('Pela nossa política, a primeira fatura é proporcional aos dias de uso.');
    });

    test('17. fonte parcial: o confirmado passa, sem completar a lacuna', async () => {
      ferramentas({ resultados: { consultar_faturas_todos_contratos: FATURAS } });
      roteiro(
        chamada('consultar_faturas_todos_contratos'),
        final('Sua fatura é de R$ 99,90 e vence em 10/10/2026. O motivo desse valor eu não tenho confirmado no sistema.'),
      );
      const r = await turno(['por que minha fatura veio esse valor?']);
      expect(r.texto).toBe('Sua fatura é de R$ 99,90 e vence em 10/10/2026. O motivo desse valor eu não tenho confirmado no sistema.');
    });

    test('17b. fonte parcial: completar a lacuna com proporcional é barrado', async () => {
      ferramentas({ setor: 'Financeiro', resultados: { consultar_faturas_todos_contratos: FATURAS } });
      roteiro(
        chamada('consultar_faturas_todos_contratos'),
        final('Sua fatura é de R$ 99,90 e inclui o proporcional de 5 dias.'),
        chamada('concluir_triagem'),
        final('Sua fatura é de R$ 99,90 e inclui o proporcional de 5 dias.'),
      );
      const r = await turno(['por que minha fatura veio esse valor?']);
      expect(vistas[2].toolChoice).toBe('concluir_triagem');
      expect(r.texto).toBe(SEM_FONTE);
    });

    test('18. terceiro financeiro continua funcionando: o PIX dela sai sem nenhuma contenção no caminho', async () => {
      roteiro(chamada('gerar_pix'), final('Enviei o PIX do contrato de Beltrana.'));
      const r = await turno(['manda o pix dela'], { identidade: SEM_IDENT, terceiro: TERCEIRO });
      expect(executeTool.mock.calls[0][0]).toBe('gerar_pix');
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(r.texto).toBe('Enviei o PIX do contrato de Beltrana.');
    });

    test('19. titular pedindo boleto continua normal', async () => {
      roteiro(chamada('enviar_boleto'), final('Enviei o boleto do seu contrato.'));
      const r = await turno(['quero o boleto']);
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(r.texto).toBe('Enviei o boleto do seu contrato.');
    });
  });

  test('modo Assistente: sem contenção nenhuma (quem decide é a atendente)', async () => {
    listToolPermissions.mockResolvedValue([]);
    listRecentMessagesByConversation.mockResolvedValue([entrada('meu roteador queimou')]);
    roteiro(final('Sugestão: peça para reiniciar o roteador.'));
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    expect(r.texto).toBe('Sugestão: peça para reiniciar o roteador.');
  });
});

// Documento pendente (25/09/2026): caso real em que a IA pediu o CPF três vezes seguidas enquanto o
// cliente, por texto e por áudio, só explicava o problema. O pedido fica marcado na própria
// mensagem (o worker grava); a pendência é derivada do histórico da conversa; o código barra a
// repetição sem avanço (correção no laço + troca final). Sem OpenAI real; documentos sintéticos.
describe('documento pendente: não repetir o pedido de CPF/CNPJ', () => {
  const { executeTool } = require('./tool-executor');
  const CPF_A = '52998224725';
  const PEDIDO = 'Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.';
  const SEM_IDENT = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
  const FULANA = { nivel: 'forte', origem: 'phone', primeiroNome: 'Fulana', contracts: [{ id: 5, statusCode: 1, address: 'RUA X' }], client: { id: 9, document: CPF_A }, contestado: false };
  const BELTRANA = { nome: 'Beltrana', contratos: [{ id: 77 }] };
  const DIA = { threshold: 0.8, maxQuestions: 5, attempts: 1, forcarConclusao: false, noturno: { ativo: false } };
  let seq = 0;
  const entrada = (content) => ({ id: `in-${seq += 1}`, direction: 'inbound', messageType: 'text', content, createdAt: new Date() });
  const audio = (transcription) => ({ id: `in-${seq += 1}`, direction: 'inbound', messageType: 'audio', transcription, transcriptionStatus: 'completed', content: null, createdAt: new Date() });
  const pediu = (content, alvo = 'principal', createdAt = new Date()) => ({ id: `out-${seq += 1}`, direction: 'outbound', messageType: 'text', sentBy: 'ai', content, metadata: { pedidoDeDocumento: { alvo } }, createdAt });
  // Horas fixas para o pedido e para a localização do terceiro (lida do escopo persistido).
  const PEDIU_EM = new Date('2026-09-25T15:00:00.000Z');
  const LOCALIZOU_DEPOIS = new Date('2026-09-25T15:02:00.000Z');
  const respondeu = (content) => ({ id: `out-${seq += 1}`, direction: 'outbound', messageType: 'text', sentBy: 'ai', content, createdAt: new Date() });
  const chamada = (nome) => ({ message: { content: null, tool_calls: [{ id: 't-' + nome, type: 'function', function: { name: nome, arguments: '{}' } }] }, usage: {} });
  const final = (content) => ({ message: { content }, usage: {} });

  let vistas;
  function roteiro(...respostas) {
    vistas = [];
    createChatCompletion.mockReset().mockImplementation(async ({ messages, toolChoice }) => {
      vistas.push({ sistema: messages[0].content, ultima: messages[messages.length - 1], toolChoice });
      return respostas.shift();
    });
  }

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 5, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-2', name: 'Suporte', aiHint: '' }, { id: 's-3', name: 'Financeiro', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Sem conexão' }]);
    executeTool.mockReset().mockImplementation(async (nome, _a, ctx) => {
      if (nome === 'concluir_triagem') {
        ctx.triagemConcluida = { setor: 'Suporte' };
        return { ok: true, resultado: { concluido: true, setor: 'Suporte', instrucao: 'Responda em uma frase.' } };
      }
      if (nome === 'encerrar_atendimento') {
        ctx.atendimentoEncerrado = true;
        return { ok: true, resultado: { encerrado: true } };
      }
      if (nome === 'gerar_pix') ctx.resolvidoPelaIa = true;
      return { ok: true, resultado: {} };
    });
  });

  const turno = (historico, extra = {}) => {
    listRecentMessagesByConversation.mockResolvedValue(historico);
    return runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: SEM_IDENT, triagem: DIA, origemMensagem: 'texto', ...extra });
  };

  describe('regressão do caso real: três pedidos de CPF', () => {
    const t1 = entrada('boa tarde, minha internet caiu desde cedo');
    const p1 = pediu(PEDIDO);
    const t2 = audio('é que desde ontem a luz ficou vermelha e nada funciona aqui');
    const r2 = respondeu('Entendi, a luz vermelha indica que a conexão caiu. Sem o cadastro eu não consigo ver o status daqui.');
    const t3 = entrada('já reiniciei tudo e continua sem internet');

    test('turno 1: a IA pede o CPF — e o turno devolve a marca de quem é o documento (o próprio)', async () => {
      roteiro(final(PEDIDO));
      const r = await turno([t1]);
      expect(r.texto).toBe(PEDIDO);
      expect(r.pedidoDeDocumento).toEqual({ alvo: 'principal' });
      expect(vistas[0].sistema).not.toContain('DOCUMENTO JÁ PEDIDO');
    });

    test('1. turno 2 (áudio, sem CPF): o pedido NÃO é repetido — a correção vem no laço', async () => {
      roteiro(
        final('Entendi! Para verificar, me informe seu CPF ou CNPJ, por favor.'),
        final('Entendi, a luz vermelha indica que a conexão caiu. Sem o cadastro eu não consigo ver o status daqui.'),
      );
      const r = await turno([t1, p1, t2]);
      expect(vistas[0].sistema).toContain('DOCUMENTO JÁ PEDIDO');
      expect(vistas[1].ultima.content).toMatch(/NÃO peça de novo nesta resposta/);
      expect(r.texto).toBe('Entendi, a luz vermelha indica que a conexão caiu. Sem o cadastro eu não consigo ver o status daqui.');
      expect(r.pedidoDeDocumento).toBeNull();
    });

    test('2. turno 3 (ainda sem CPF): nem pela terceira vez — mesmo com o modelo insistindo, e a consulta segue bloqueada', async () => {
      executeTool.mockResolvedValueOnce({ ok: false, motivo: 'identity_not_confirmed', instrucao: 'Ainda não sei quem é o cliente, e o CPF ou CNPJ JÁ foi pedido: NÃO peça de novo agora.' });
      roteiro(
        chamada('consultar_status_todos_contratos'),
        final('Entendo. Me passa o CPF do titular para eu consultar?'),
        final('Certo. Qual o CPF ou CNPJ?'),
      );
      const r = await turno([t1, p1, t2, r2, t3]);
      expect(executeTool.mock.calls[0][0]).toBe('consultar_status_todos_contratos');
      expect(r.texto).toBe('Certo.');
      expect(r.texto).not.toMatch(/CPF|CNPJ/);
    });
  });

  test('3. o CPF veio: recebido (ainda não confirmado) e buscar_cliente segue normalmente', async () => {
    roteiro(chamada('buscar_cliente'), final('Localizei seu cadastro, Maria.'));
    const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('meu cpf é 529.982.247-25')]);
    expect(vistas[0].sistema).not.toContain('DOCUMENTO JÁ PEDIDO');
    expect(vistas[0].sistema).toContain('DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO');
    expect(executeTool.mock.calls[0][0]).toBe('buscar_cliente');
    expect(r.texto).toBe('Localizei seu cadastro, Maria.');
  });

  test('4. o CPF veio em áudio transcrito: igual', async () => {
    roteiro(chamada('buscar_cliente'), final('Localizei seu cadastro, Maria.'));
    await turno([entrada('caiu a internet'), pediu(PEDIDO), audio('o meu cpf é 529 982 247 25')]);
    expect(vistas[0].sistema).toContain('DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO');
    expect(executeTool.mock.calls[0][0]).toBe('buscar_cliente');
  });

  // Número recebido != identidade confirmada (ajuste de 25/09/2026): 11 ou 14 dígitos podem ser
  // telefone, número errado ou documento inexistente. O número é tentado; pedir para conferir é
  // avanço; a pendência só termina com a identificação (ou a localização do terceiro) confirmada.
  describe('número recebido não é identidade confirmada', () => {
    const CONFERE = 'Não consegui localizar com esse número. Confere o CPF ou CNPJ do titular para mim?';
    const naoAchou = ({ deTerceiro = false } = {}) => executeTool.mockImplementation(async (nome, _a, ctx) => {
      if (nome === 'buscar_cliente' && deTerceiro) {
        // Terceiro não encontrado: a trava do turno fica vazia e o escopo vira pendente (tool-registry).
        ctx.alvoTerceiro = { contratos: [] };
        ctx.terceiro = { nome: null, contratos: [], pendente: true };
      }
      return { ok: false, motivo: 'execution_error' };
    });

    test('1. telefone de 11 dígitos: tentado, não localizado — pedir para conferir é permitido (e é um pedido novo)', async () => {
      naoAchou();
      roteiro(chamada('buscar_cliente'), final(CONFERE));
      const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('meu telefone é 98991234567')]);
      expect(executeTool.mock.calls[0][0]).toBe('buscar_cliente');
      expect(r.texto).toBe(CONFERE);
      expect(r.pedidoDeDocumento).toEqual({ alvo: 'principal' });
    });

    test('1b. depois do "confere", sem número novo: não entra em loop mecânico', async () => {
      roteiro(final('Entendi. Me passa o CPF ou CNPJ, por favor?'), final('Me passa o CPF?'));
      const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('meu telefone é 98991234567'), pediu(CONFERE), entrada('é esse mesmo')]);
      expect(r.texto).toBe('Entendi.');
    });

    test('1c. o mesmo número de novo também não é informação nova', async () => {
      roteiro(final('Confere o CPF?'), final('Esse número não localizou. Confere o CPF?'));
      const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('98991234567'), pediu(CONFERE), entrada('98991234567')]);
      expect(r.texto).toBe('Esse número não localizou.');
    });

    test('2. CPF inexistente: a tentativa ocorre, a pendência continua e a conferência é permitida', async () => {
      naoAchou();
      roteiro(chamada('buscar_cliente'), final(CONFERE));
      const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('é 111.444.777-35')]);
      expect(executeTool.mock.calls[0][0]).toBe('buscar_cliente');
      expect(r.texto).toBe(CONFERE);
    });

    test('3. CPF localizado (quem fala identificado): a pendência termina — no turno seguinte não há mais nada pendente', async () => {
      executeTool.mockImplementation(async (nome, _a, ctx) => {
        if (nome === 'buscar_cliente') ctx.identidade = { ...FULANA, origem: 'cpf' };
        return { ok: true, resultado: {} };
      });
      roteiro(chamada('buscar_cliente'), final('Localizei seu cadastro, Fulana. Me confirma seu CPF?'), final('Localizei seu cadastro, Fulana.'));
      const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada(`meu cpf é ${CPF_A}`)]);
      expect(r.texto).toBe('Localizei seu cadastro, Fulana.');

      roteiro(final('Verifiquei aqui, Fulana.'));
      await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada(`meu cpf é ${CPF_A}`), respondeu('Localizei seu cadastro, Fulana.'), entrada('e aí?')], { identidade: FULANA });
      expect(vistas[0].sistema).not.toMatch(/DOCUMENTO (JÁ PEDIDO|RECEBIDO)/);
    });

    test('5. terceiro com documento inválido: não localizado, a pendência permanece e a conferência é permitida', async () => {
      naoAchou({ deTerceiro: true });
      roteiro(chamada('buscar_cliente'), final('Não localizei esse CPF. Confere o CPF da Beltrana para mim?'));
      const r = await turno([entrada('quero o pix da Beltrana'), pediu('Qual o CPF da Beltrana?', 'terceiro'), entrada('é 111.444.777-35')], { identidade: FULANA, terceiro: null });
      expect(r.texto).toBe('Não localizei esse CPF. Confere o CPF da Beltrana para mim?');
    });

    test('6. terceiro localizado neste turno: a pendência termina e não pede o documento dela de novo', async () => {
      executeTool.mockImplementation(async (nome, _a, ctx) => {
        if (nome === 'buscar_cliente') {
          ctx.alvoTerceiro = { contratos: [77] };
          ctx.terceiro = BELTRANA;
        }
        return { ok: true, resultado: {} };
      });
      roteiro(chamada('buscar_cliente'), final('Qual o CPF dela?'), final('Localizei o contrato no CPF informado. Quer o PIX agora?'));
      const r = await turno([entrada('quero o pix da Beltrana'), pediu('Qual o CPF da Beltrana?', 'terceiro'), entrada('é 111.444.777-35')], { identidade: FULANA, terceiro: null });
      expect(vistas[2].ultima.content).toMatch(/JÁ foi localizado/);
      expect(r.texto).toBe('Localizei o contrato no CPF informado. Quer o PIX agora?');
      // O fato não viaja na resposta: ele já está no escopo que buscar_cliente gravou.
      expect(r).not.toHaveProperty('documentoConfirmado');
    });

    test('7. áudio com telefone de 11 dígitos: recebido, não confundido com identificação confirmada', async () => {
      naoAchou();
      roteiro(chamada('buscar_cliente'), final(CONFERE));
      const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), audio('o número é 98991234567')]);
      expect(vistas[0].sistema).toContain('DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO');
      expect(r.texto).toBe(CONFERE);
    });
  });

  test('5. cliente já identificado: pedir o CPF dele é barrado', async () => {
    roteiro(final(PEDIDO), final('Verifiquei aqui, Fulana: seu contrato está ativo.'));
    const r = await turno([entrada('minha internet caiu')], { identidade: FULANA });
    expect(vistas[1].ultima.content).toMatch(/JÁ está identificado/);
    expect(r.texto).toBe('Verifiquei aqui, Fulana: seu contrato está ativo.');
  });

  test('6. identificado depois do pedido (telefone): a pendência do próprio termina', async () => {
    roteiro(final('Verifiquei aqui, Fulana.'));
    await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('e aí?')], { identidade: FULANA });
    expect(vistas[0].sistema).not.toContain('DOCUMENTO JÁ PEDIDO');
  });

  test('7. mudou de assunto: responde ao assunto novo, sem forçar o documento', async () => {
    roteiro(final('Atendemos sim! Me passa seu CPF para eu verificar?'), final('Atendemos sim! Qual é o seu bairro?'));
    const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('Na verdade só queria saber se vocês atendem meu bairro.')]);
    expect(vistas[0].sistema).toMatch(/Ele mudou de assunto depois do pedido/);
    expect(r.texto).toBe('Atendemos sim! Qual é o seu bairro?');
  });

  test('8. voltou ao assunto que depende da identificação: o lembrete natural é permitido (e fica marcado)', async () => {
    roteiro(final('Consigo sim: para ver a sua conexão, é só me passar o CPF ou CNPJ do titular.'));
    const r = await turno([
      entrada('caiu a internet'), pediu(PEDIDO), entrada('Na verdade só queria saber se vocês atendem meu bairro.'),
      respondeu('Atendemos sim!'), entrada('ah, e a minha internet que caiu, vocês conseguem ver?'),
    ]);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(r.texto).toBe('Consigo sim: para ver a sua conexão, é só me passar o CPF ou CNPJ do titular.');
    expect(r.pedidoDeDocumento).toEqual({ alvo: 'principal' });
  });

  test('9. cliente irritado com a repetição: não insiste, não discute', async () => {
    roteiro(final('Preciso do CPF para seguir.'), final('Preciso do seu CPF, por favor.'));
    const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('já falei que a internet caiu, para de pedir isso')]);
    expect(vistas[1].ultima.content).toMatch(/não discuta/);
    expect(r.texto).toBe('Entendi, desculpe a insistência.');
  });

  test('10. terceiro: o CPF pendente é o da Beltrana — o da Fulana não responde', async () => {
    roteiro(final('Esse documento é o seu. Para o PIX da Beltrana, preciso do CPF ou CNPJ dela.'));
    const r = await turno(
      [entrada('quero o pix da Beltrana'), pediu('Qual o CPF ou CNPJ da Beltrana?', 'terceiro'), entrada(`é o meu: ${CPF_A}`)],
      { identidade: FULANA },
    );
    expect(vistas[0].sistema).toMatch(/da OUTRA pessoa/);
    expect(vistas[0].sistema).toMatch(/o que ele mandou é o dele mesmo/);
    expect(r.texto).toBe('Esse documento é o seu. Para o PIX da Beltrana, preciso do CPF ou CNPJ dela.');
    expect(r.pedidoDeDocumento).toEqual({ alvo: 'terceiro' });
  });

  test('11. terceiro já localizado: não pede o documento dela de novo', async () => {
    roteiro(final('Qual o CPF dela?'), chamada('gerar_pix'), final('Enviei o PIX do contrato de Beltrana.'));
    const r = await turno(
      [entrada('quero o pix da Beltrana'), pediu('Qual o CPF da Beltrana?', 'terceiro', PEDIU_EM), entrada('11144477735'), respondeu('Localizei o contrato no CPF informado.'), entrada('manda o pix dela')],
      { identidade: FULANA, terceiro: BELTRANA, terceiroLocalizadoEm: LOCALIZOU_DEPOIS },
    );
    expect(vistas[1].ultima.content).toMatch(/JÁ foi localizado/);
    expect(r.texto).toBe('Enviei o PIX do contrato de Beltrana.');
  });

  test('12. novo terceiro: pedir o documento da pessoa nova não é repetição', async () => {
    roteiro(final('Claro! Qual o CPF ou CNPJ da sua mãe?'));
    const r = await turno(
      [entrada('quero o pix da Beltrana'), pediu('Qual o CPF da Beltrana?', 'terceiro', PEDIU_EM), entrada('11144477735'), respondeu('Localizei.'), entrada('agora quero o boleto da minha mãe')],
      { identidade: FULANA, terceiro: BELTRANA, terceiroLocalizadoEm: LOCALIZOU_DEPOIS },
    );
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(r.texto).toBe('Claro! Qual o CPF ou CNPJ da sua mãe?');
    expect(r.pedidoDeDocumento).toEqual({ alvo: 'terceiro' });
  });

  // Identidade confirmada é FATO DO SISTEMA (ajuste de 25/09/2026): buscar_cliente grava o escopo do
  // terceiro localizado ANTES de devolver; o worker lê desse escopo a hora da localização e passa ao
  // turno. Nenhuma resposta da IA precisa ter sido salva para o próximo turno saber.
  describe('confirmação do terceiro vem do escopo persistido, não da resposta da IA', () => {
    const PEDIDO_BELTRANA = () => pediu('Qual o CPF da Beltrana?', 'terceiro', PEDIU_EM);

    test('1. localizado e a resposta foi salva normalmente: a pendência termina', async () => {
      roteiro(final('Qual o CPF dela?'), final('Quer o PIX agora?'));
      const r = await turno(
        [entrada('quero o pix da Beltrana'), PEDIDO_BELTRANA(), entrada('é 111.444.777-35'), respondeu('Localizei o contrato no CPF informado.'), entrada('ok')],
        { identidade: FULANA, terceiro: BELTRANA, terceiroLocalizadoEm: LOCALIZOU_DEPOIS },
      );
      expect(vistas[0].sistema).not.toMatch(/DOCUMENTO (JÁ PEDIDO|RECEBIDO)/);
      expect(r.texto).toBe('Quer o PIX agora?');
    });

    test('2. localizado, mas a resposta daquele turno foi DESCARTADA (anti-repetição): continua resolvida, sem pedir o CPF de novo', async () => {
      roteiro(final('Me passa o CPF da Beltrana, por favor?'), final('Me passa o CPF dela?'));
      // Nenhuma resposta da IA depois do documento: o turno que localizou não mandou nada.
      const r = await turno(
        [entrada('quero o pix da Beltrana'), PEDIDO_BELTRANA(), entrada('é 111.444.777-35'), entrada('e aí, localizou?')],
        { identidade: FULANA, terceiro: BELTRANA, terceiroLocalizadoEm: LOCALIZOU_DEPOIS },
      );
      expect(vistas[0].sistema).not.toMatch(/DOCUMENTO (JÁ PEDIDO|RECEBIDO)/);
      expect(vistas[1].ultima.content).toMatch(/JÁ foi localizado/);
      expect(r.texto).toBe('Entendi.');
      expect(r.texto).not.toMatch(/CPF/);
    });

    test('3. localizado e a resposta ficou vazia/não salva: o próximo turno ainda sabe', async () => {
      roteiro(final('Quer o PIX da Beltrana agora?'));
      await turno(
        [entrada('quero o pix da Beltrana'), PEDIDO_BELTRANA(), entrada('é 111.444.777-35'), entrada('?')],
        { identidade: FULANA, terceiro: BELTRANA, terceiroLocalizadoEm: LOCALIZOU_DEPOIS },
      );
      expect(vistas[0].sistema).not.toMatch(/DOCUMENTO (JÁ PEDIDO|RECEBIDO)/);
    });

    test('4. NÃO localizado (escopo pendente, sem hora de localização) e resposta descartada: continua recebido, não confirmado', async () => {
      roteiro(final('Não localizei esse CPF. Confere para mim?'));
      const r = await turno(
        [entrada('quero o pix da Beltrana'), PEDIDO_BELTRANA(), entrada('é 111.444.777-35'), entrada('e aí?')],
        { identidade: FULANA, terceiro: { nome: null, contratos: [], pendente: true }, terceiroLocalizadoEm: null },
      );
      expect(vistas[0].sistema).toContain('DOCUMENTO RECEBIDO, AINDA NÃO CONFIRMADO');
      expect(r.texto).toBe('Não localizei esse CPF. Confere para mim?');
    });

    test('5. terceiro A localizado ANTES do pedido do terceiro B: não encerra o pedido de B', async () => {
      roteiro(final('Qual o CPF da sua mãe?'), final('Entendi.'));
      await turno(
        [
          entrada('quero o pix da Beltrana'), pediu('Qual o CPF da Beltrana?', 'terceiro', new Date('2026-09-25T14:50:00.000Z')), entrada('é 111.444.777-35'),
          respondeu('Localizei.'), entrada('agora quero o da minha mãe'), PEDIDO_BELTRANA(), entrada('um instante'),
        ],
        { identidade: FULANA, terceiro: BELTRANA, terceiroLocalizadoEm: new Date('2026-09-25T14:55:00.000Z') },
      );
      expect(vistas[0].sistema).toContain('DOCUMENTO JÁ PEDIDO');
    });

    test('9. conversa nova: sem pedido no histórico, nada herdado (o escopo é por conversa)', async () => {
      roteiro(final('Bom dia! Como posso ajudar?'));
      await turno([entrada('bom dia, quero o pix')], { identidade: FULANA, terceiro: null, terceiroLocalizadoEm: null });
      expect(vistas[0].sistema).not.toMatch(/DOCUMENTO (JÁ PEDIDO|RECEBIDO)/);
    });
  });

  test('14. depois de encaminhar para um humano: nenhum pedido de documento', async () => {
    roteiro(chamada('concluir_triagem'), final('Encaminhei para o Suporte. Me passa seu CPF para agilizar?'), final('Encaminhei para o Suporte. Me passa seu CPF?'));
    const r = await turno([entrada('caiu a internet'), pediu(PEDIDO), entrada('não sei o cpf agora')]);
    expect(r.triagemConcluida).toEqual({ setor: 'Suporte' });
    expect(r.texto).toBe('Encaminhei para o Suporte.');
    expect(r.pedidoDeDocumento).toBeNull();
  });

  test('15. encerrado: a despedida não pede documento; e a conversa nova não herda pendência', async () => {
    // Sem pedido anterior: só o encerramento barra o pedido na despedida.
    roteiro(chamada('encerrar_atendimento'), final('Até logo! Se precisar, me passa o CPF.'), final('Até logo! Me passa o CPF.'));
    const r = await turno([entrada('obrigado, era só isso')]);
    expect(r.texto).toBe('Até logo!');
    expect(r.pedidoDeDocumento).toBeNull();

    roteiro(final('Bom dia! Como posso ajudar?'));
    await turno([entrada('bom dia, caiu a internet')]);
    expect(vistas[0].sistema).not.toContain('DOCUMENTO JÁ PEDIDO');
  });

  test('16. modo Assistente: nada muda', async () => {
    listToolPermissions.mockResolvedValue([]);
    listRecentMessagesByConversation.mockResolvedValue([entrada('caiu a internet'), pediu(PEDIDO), entrada('é que nada funciona')]);
    roteiro(final('Sugestão: peça o CPF do titular.'));
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    expect(r.texto).toBe('Sugestão: peça o CPF do titular.');
  });
});


// Regra financeira 0/1/2+ (25/09/2026): "pagamento confirmado", "internet liberada" e "está
// conectada" só com FATO do sistema no turno. Uma correção por turno; se o modelo insistir, a troca
// final tira a frase. Testes 37–39 do pedido, pelo runAiTurn de verdade (OpenAI fingida).
describe('frases proibidas sem fato do sistema (pagamento, liberação, conexão)', () => {
  const { executeTool } = require('./tool-executor');
  const ANA = { nivel: 'forte', origem: 'phone', primeiroNome: 'Ana', contracts: [{ id: 100, statusCode: 4, address: 'RUA A' }], client: { id: 9, document: '00000000191' }, contestado: false };
  const DIA = { threshold: 0.8, maxQuestions: 5, attempts: 1, forcarConclusao: false, noturno: { ativo: false } };
  const final = (content) => ({ message: { content }, usage: {} });
  const chamada = (nome) => ({ message: { content: null, tool_calls: [{ id: `t-${nome}`, type: 'function', function: { name: nome, arguments: '{}' } }] }, usage: {} });
  let vistas;
  function roteiro(...respostas) {
    vistas = [];
    createChatCompletion.mockReset().mockImplementation(async ({ messages }) => {
      vistas.push({ ultima: messages[messages.length - 1] });
      return respostas.shift();
    });
  }
  const turno = (fala = 'já paguei, pode ver?') => {
    listRecentMessagesByConversation.mockResolvedValue([{ id: 'in-1', direction: 'inbound', messageType: 'text', content: fala, createdAt: new Date() }]);
    return runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: ANA, triagem: DIA, origemMensagem: 'texto' });
  };

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 5, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-3', name: 'Financeiro', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Pagamento' }]);
    executeTool.mockReset().mockResolvedValue({ ok: true, resultado: {} });
  });

  test('37. "pagamento confirmado" sem prova: corrigido; se insistir, a frase sai da resposta', async () => {
    roteiro(
      final('Oi Ana! Pagamento confirmado, obrigada!'),
      final('Pagamento confirmado! Qualquer dúvida, é só chamar.'),
    );
    const r = await turno();
    expect(vistas[1].ultima).toEqual(expect.objectContaining({ role: 'system', content: expect.stringMatching(/conferir_pagamento/) }));
    expect(r.texto).not.toMatch(/confirmad/i);
    expect(r.texto).toBe('Qualquer dúvida, é só chamar.');
  });

  test('37b. com conferir_pagamento confirmando o MESMO título, a frase passa sem correção', async () => {
    executeTool.mockImplementation(async (nome, _a, ctx) => {
      if (nome === 'conferir_pagamento') ctx.pagamentoConfirmado = true;
      return { ok: true, resultado: { pagamentoConfirmado: true } };
    });
    roteiro(chamada('conferir_pagamento'), final('Pagamento confirmado, Ana! Obrigada.'));
    const r = await turno();
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(r.texto).toBe('Pagamento confirmado, Ana! Obrigada.');
  });

  test('38. "internet já foi liberada" só porque chegou comprovante: bloqueada', async () => {
    executeTool.mockImplementation(async (nome, _a, ctx) => {
      if (nome === 'analisar_comprovante') ctx.comprovante = { valido: true, valor: 99.9 };
      return { ok: true, resultado: { analisado: true, valido: true } };
    });
    roteiro(
      final('Recebi seu comprovante, Ana. Sua internet já foi liberada!'),
      final('Recebi seu comprovante, Ana. Sua internet já foi liberada!'),
    );
    const r = await turno('mandei o comprovante');
    expect(vistas[1].ultima).toEqual(expect.objectContaining({ role: 'system', content: expect.stringMatching(/liberação/) }));
    expect(r.texto).toBe('Recebi seu comprovante, Ana.');
    expect(hasRecentTrustUnlockByContact).toHaveBeenCalled();
  });

  test('38b. com a releitura do contrato ATIVO (conferir_pagamento), "liberado" passa — "online" não', async () => {
    executeTool.mockImplementation(async (nome, _a, ctx) => {
      if (nome === 'conferir_pagamento') {
        ctx.pagamentoConferido = true;
        ctx.pagamentoConfirmado = true;
        ctx.contratoAtivoConfirmado = true;
      }
      return { ok: true, resultado: { pagamentoConfirmado: true, contratoAtivo: true } };
    });
    roteiro(
      chamada('conferir_pagamento'),
      final('Pagamento confirmado e seu contrato foi liberado, Ana! Sua internet já está online.'),
      final('Pagamento confirmado e seu contrato foi liberado, Ana! Sua internet já está online.'),
    );
    const r = await turno();
    expect(r.texto).toBe('Pagamento confirmado e seu contrato foi liberado, Ana!');
  });

  test('39. "seu pagamento já compensou" com o título ainda Gerado: bloqueada', async () => {
    executeTool.mockImplementation(async (nome, _a, ctx) => {
      if (nome === 'conferir_pagamento') ctx.pagamentoConferido = true;
      return { ok: true, resultado: { pagamentoConfirmado: false, instrucao: 'O pagamento desta fatura AINDA NÃO consta como confirmado no sistema.' } };
    });
    roteiro(
      chamada('conferir_pagamento'),
      final('Ana, seu pagamento já compensou.'),
      final('Ana, seu pagamento já compensou.'),
    );
    const r = await turno();
    expect(r.texto).toBe('O pagamento ainda não consta como confirmado no sistema.');
  });

  test('no assistente (humano no comando) a guarda não mexe no texto', async () => {
    roteiro(final('Pagamento confirmado.'));
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    expect(r.texto).toBe('Pagamento confirmado.');
  });
});

describe('guarda de pagamento: o banco fora do ar não derruba o turno', () => {
  test('falha ao ler a liberação recente: a frase de liberação sai da resposta, e o turno responde', async () => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 5, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-3', name: 'Financeiro', aiHint: '' }]);
    hasRecentTrustUnlockByContact.mockRejectedValue(new Error('db fora'));
    createChatCompletion.mockReset()
      .mockResolvedValueOnce({ message: { content: 'Oi Ana. Sua internet já foi liberada.' }, usage: {} })
      .mockResolvedValueOnce({ message: { content: 'Oi Ana. Sua internet já foi liberada.' }, usage: {} });
    const identidade = { nivel: 'forte', origem: 'phone', primeiroNome: 'Ana', contracts: [{ id: 100, statusCode: 4, address: 'RUA A' }], client: { id: 9 }, contestado: false };
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade, triagem: { threshold: 0.8, maxQuestions: 5, attempts: 1, forcarConclusao: false, noturno: { ativo: false } }, origemMensagem: 'texto' });
    expect(r.texto).toBe('Oi Ana.');
  });
});

// Ajuste de 25/09/2026: a marca de reativação da conversa (fato gravado pelo gate) chega ao prompt
// deste turno e ao contexto das ferramentas — a regra dos 90 dias não manda para o financeiro uma
// conversa que o gate mandou para a reativação. Marcada no meio do turno, a volta seguinte já vê.
describe('marca de reativação no prompt e no contexto do turno', () => {
  const { executeTool } = require('./tool-executor');
  const ANA = { nivel: 'forte', origem: 'phone', primeiroNome: 'Ana', contracts: [{ id: 100, statusCode: 4, address: 'RUA A' }], client: { id: 9 }, contestado: false };
  const DIA = { threshold: 0.8, maxQuestions: 5, attempts: 1, forcarConclusao: false, noturno: { ativo: false } };
  const turno = (extra = {}) => runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: ANA, triagem: DIA, origemMensagem: 'texto', ...extra });
  const sistema = (i) => createChatCompletion.mock.calls[i][0].messages[0].content;

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 5, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-3', name: 'Financeiro', aiHint: '' }, { id: 's-4', name: 'Reativação', aiHint: '' }]);
    listRecentMessagesByConversation.mockResolvedValue([{ id: 'in-1', direction: 'inbound', messageType: 'text', content: 'quero o pix', createdAt: new Date() }]);
    executeTool.mockReset().mockResolvedValue({ ok: true, resultado: {} });
  });

  test('marcada antes do turno: o prompt manda para a reativação e as ferramentas veem a marca', async () => {
    let visto;
    executeTool.mockImplementation(async (_n, _a, ctx) => { visto = ctx.reativacao; return { ok: true, resultado: {} }; });
    // O array de mensagens é o mesmo objeto no turno inteiro (e é recomposto no meio): guarda o
    // prompt NA HORA de cada chamada — a PRIMEIRA já tem de nascer com a marca.
    const prompts = [];
    const respostas = [
      { message: { content: null, tool_calls: [{ id: 't1', function: { name: 'gerar_pix', arguments: '{}' } }] }, usage: {} },
      { message: { content: 'Certo, Ana.' }, usage: {} },
    ];
    createChatCompletion.mockReset().mockImplementation(async ({ messages }) => {
      prompts.push(messages[0].content);
      return respostas.shift();
    });
    await turno({ reativacao: 'multiplas_vencidas' });
    expect(prompts[0]).toMatch(/Esta conversa já está marcada para o setor que cuida de reativação/);
    expect(prompts[0]).not.toMatch(/Até 90 dias continua sendo/);
    expect(visto).toBe('multiplas_vencidas');
  });

  test('sem marca: o prompt traz a exceção da regra 0/1/2+ na regra dos 90 dias', async () => {
    createChatCompletion.mockReset().mockResolvedValueOnce({ message: { content: 'Oi, Ana.' }, usage: {} });
    await turno();
    expect(sistema(0)).toMatch(/essa regra vem antes da dos 90 dias/);
    expect(sistema(0)).not.toMatch(/Esta conversa já está marcada/);
  });

  test('marcada no meio do turno pelo gate: a volta seguinte já vê a marca no prompt', async () => {
    executeTool.mockImplementation(async (_n, _a, ctx) => {
      ctx.reativacao = 'multiplas_vencidas';
      return { ok: true, resultado: { cobrancaBloqueada: 'reativacao' } };
    });
    // O array de mensagens é o mesmo objeto no turno inteiro: guarda o prompt NA HORA de cada chamada.
    const prompts = [];
    const respostas = [
      { message: { content: null, tool_calls: [{ id: 't1', function: { name: 'gerar_pix', arguments: '{}' } }] }, usage: {} },
      { message: { content: 'Ana, há mais de uma fatura em atraso.' }, usage: {} },
    ];
    createChatCompletion.mockReset().mockImplementation(async ({ messages }) => {
      prompts.push(messages[0].content);
      return respostas.shift();
    });
    await turno();
    expect(prompts[0]).not.toMatch(/Esta conversa já está marcada/);
    expect(prompts[1]).toMatch(/Esta conversa já está marcada para o setor que cuida de reativação/);
  });
});

// P1-1 da auditoria final (25/09/2026): contrato SUSPENSO numa cidade com aviso ativo. O fato
// financeiro do SGP vence: a troca final NÃO põe a ocorrência regional no lugar da resposta sobre
// a suspensão. Contrato ativo e equipamento queimado continuam como antes.
describe('P1-1: a troca final pelo aviso respeita o contrato suspenso', () => {
  const { respostaSeguraDoAviso } = require('./regional-outage');
  const { executeTool } = require('./tool-executor');
  const FATO = { cidade: 'Maracaçumé', mensagem: 'Instabilidade na rede da cidade.', desde: '2026-09-25T12:00:00.000Z', impacto: null };
  const identidadeCom = (contracts) => ({ nivel: 'forte', origem: 'phone', primeiroNome: 'Maria', contracts, client: { id: 9, document: '11122233344' }, contestado: false });
  const SUSPENSO = { id: 5, statusCode: 4, address: 'RUA X' };
  const ATIVO = { id: 6, statusCode: 1, address: 'RUA Y' };
  const TRIAGEM_AV = { threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false };
  const entrada = (content) => ({ id: 'in-1', direction: 'inbound', messageType: 'text', content, createdAt: new Date() });
  const final = (content) => ({ message: { content }, usage: {} });
  const chamada = (nome, args = {}) => ({ message: { content: null, tool_calls: [{ id: `t-${nome}`, type: 'function', function: { name: nome, arguments: JSON.stringify(args) } }] }, usage: {} });

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-2', name: 'Suporte', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Sem conexão' }]);
    createChatCompletion.mockReset();
    executeTool.mockReset().mockResolvedValue({ ok: true, resultado: {} });
    listRecentMessagesByConversation.mockResolvedValue([entrada('boa tarde, estou sem internet')]);
  });

  const turno = (contracts, extra = {}) => runAiTurn({
    conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: identidadeCom(contracts), triagem: TRIAGEM_AV, origemMensagem: 'texto', avisoCidade: FATO, ...extra,
  });

  test('3. suspenso: resposta sobre a suspensão com "em breve" NÃO vira o aviso regional', async () => {
    const resposta = 'Seu contrato consta suspenso por uma pendência na fatura. Em breve te envio o PIX para regularizar.';
    createChatCompletion.mockResolvedValueOnce(final(resposta));
    const r = await turno([SUSPENSO]);
    expect(r.texto).toBe(resposta);
  });

  test('4. suspenso: resposta sobre a suspensão com "reinicie" NÃO vira o aviso regional', async () => {
    const resposta = 'Seu contrato consta suspenso por uma pendência na fatura. Depois do pagamento, se precisar, reinicie o roteador.';
    createChatCompletion.mockResolvedValueOnce(final(resposta));
    const r = await turno([SUSPENSO]);
    expect(r.texto).toBe(resposta);
  });

  test('suspenso descoberto no meio do turno (buscar_cliente): também não troca', async () => {
    createChatCompletion.mockResolvedValueOnce(chamada('buscar_cliente')).mockResolvedValueOnce(final('Seu contrato consta suspenso. Em breve te mando o boleto.'));
    executeTool.mockImplementation(async (_n, _a, ctx) => { ctx.contracts = [SUSPENSO]; ctx.avisoCidade = FATO; return { ok: true, resultado: {} }; });
    const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false }, triagem: TRIAGEM_AV, origemMensagem: 'texto' });
    expect(r.texto).toBe('Seu contrato consta suspenso. Em breve te mando o boleto.');
  });

  test('um suspenso e um ativo, sem saber de qual ele fala: não inventa causa única (não troca)', async () => {
    const resposta = 'Reinicie o roteador, por favor.';
    createChatCompletion.mockResolvedValueOnce(final(resposta));
    const r = await turno([SUSPENSO, ATIVO]);
    expect(r.texto).toBe(resposta);
  });

  test('um suspenso e um ativo, com o contrato ATIVO determinado pela consulta de conexão: o aviso vale para ele', async () => {
    createChatCompletion.mockResolvedValueOnce(chamada('consultar_status_conexao', { contratoId: 6 })).mockResolvedValueOnce(final('Reinicie o roteador, por favor.'));
    executeTool.mockImplementation(async (_n, args, ctx) => { ctx.contratoDaReclamacao = args.contratoId; return { ok: true, resultado: { status: 'offline' } }; });
    const r = await turno([SUSPENSO, ATIVO]);
    expect(r.texto).toBe(respostaSeguraDoAviso(FATO));
  });

  test('5. contrato ativo + aviso compatível: a troca pelo aviso continua funcionando', async () => {
    createChatCompletion.mockResolvedValueOnce(final('Reinicie o roteador e faça um teste de velocidade.'));
    const r = await turno([ATIVO]);
    expect(r.texto).toBe(respostaSeguraDoAviso(FATO));
  });

  test('6. equipamento queimado + aviso: o equipamento continua com prioridade (nunca a ocorrência)', async () => {
    listRecentMessagesByConversation.mockResolvedValue([entrada('o roteador queimou, não liga mais')]);
    createChatCompletion
      .mockResolvedValueOnce(final('Há uma ocorrência na rede na sua região.'))
      .mockResolvedValueOnce(final('Há uma ocorrência na rede na sua região.'));
    const r = await turno([ATIVO]);
    expect(r.texto).not.toBe(respostaSeguraDoAviso(FATO));
    expect(r.texto).not.toMatch(/ocorrência/);
  });
});

// P2-1 da auditoria final (25/09/2026): cliente ATIVO (status 1 lido no turno) perguntando se está
// bloqueado. "O contrato consta ativo / o acesso está liberado" sai como está — sem correção, sem
// consulta ao banco e sem frase que sugira bloqueio. "Está online" sem verificação de conexão sai.
describe('P2-1: contrato ativo lido no turno', () => {
  const { executeTool } = require('./tool-executor');
  const ATIVA = { nivel: 'forte', origem: 'phone', primeiroNome: 'Maria', contracts: [{ id: 6, statusCode: 1, address: 'RUA Y' }], client: { id: 9, document: '11122233344' }, contestado: false };
  const DIA = { threshold: 0.8, maxQuestions: 5, attempts: 1, forcarConclusao: false, noturno: { ativo: false } };
  const final = (content) => ({ message: { content }, usage: {} });

  beforeEach(() => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: null, triageConfidenceThreshold: 0.8, triageMaxQuestions: 5, triageResolvedReasonId: null });
    listSectors.mockResolvedValue([{ id: 's-2', name: 'Suporte', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Sem conexão' }]);
    listRecentMessagesByConversation.mockResolvedValue([{ id: 'in-1', direction: 'inbound', messageType: 'text', content: 'minha internet está bloqueada?', createdAt: new Date() }]);
    executeTool.mockReset().mockResolvedValue({ ok: true, resultado: {} });
    createChatCompletion.mockReset();
  });

  const turno = () => runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: ATIVA, triagem: DIA, origemMensagem: 'texto' });

  test('"acesso liberado / contrato ativo" passa sem correção e sem ir ao banco', async () => {
    const resposta = 'Não, Maria: seu acesso está liberado, o contrato consta ativo no sistema.';
    createChatCompletion.mockResolvedValueOnce(final(resposta));
    const r = await turno();
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(hasRecentTrustUnlockByContact).not.toHaveBeenCalled();
    expect(r.texto).toBe(resposta);
  });

  test('"sua internet está online" sem verificação da conexão: corrigido; se insistir, sai a frase neutra', async () => {
    createChatCompletion
      .mockResolvedValueOnce(final('Sua internet está online.'))
      .mockResolvedValueOnce(final('Sua internet está online.'));
    const r = await turno();
    expect(r.texto).toBe('O contrato consta ativo no sistema, mas ainda preciso verificar o status da conexão.');
  });
});
