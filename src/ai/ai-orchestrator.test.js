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
const { runAiTurn, FERRAMENTAS_TRIAGEM, FERRAMENTAS_TRIAGEM_NOTURNO, FERRAMENTAS_TRIAGEM_COMPROVANTE_DIA } = require('./ai-orchestrator');

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
      .mockResolvedValueOnce({ message: { content: 'Pode me informar sua data de nascimento?' }, usage: {} });
    executeTool.mockResolvedValue({
      ok: false,
      motivo: 'identity_not_confirmed',
      detalhe: 'enviar_boleto',
      instrucao: 'Identidade ainda não confirmada. Pergunte a data de nascimento e chame confirmar_nascimento; depois chame esta ferramenta de novo. Não peça o CPF de novo.',
    });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const toolMessage = createChatCompletion.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toEqual({
      erro: 'identity_not_confirmed',
      instrucao: 'Identidade ainda não confirmada. Pergunte a data de nascimento e chame confirmar_nascimento; depois chame esta ferramenta de novo. Não peça o CPF de novo.',
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

  // I4 (fix round 1, ai-triage): confirmar_nascimento's argument is named
  // "data", not "cpf"/"documento" — CHAVE_DOCUMENTO didn't cover it, so the
  // customer's birth date reached ai_interactions unmasked. Widened the
  // pattern to also catch "nascimento" and an exact "data" key.
  // Fix round 2: maskDocument mantém os 3 primeiros e os 4 últimos
  // caracteres — em '20/05/1990' isso ainda entrega o dia ('20/') e o ano
  // ('1990') de nascimento. Uma data não é um documento parcialmente
  // mascarável; o valor inteiro precisa virar um literal fixo.
  test('replaces the data (birth date) argument of confirmar_nascimento with a fixed literal in the audit trail, but still passes the real value to the tool', async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        message: {
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'confirmar_nascimento', arguments: '{"data":"20/05/1990"}' } }],
        },
        usage: {},
      })
      .mockResolvedValueOnce({ message: { content: 'Confirmado.' }, usage: {} });
    executeTool.mockResolvedValue({ ok: true, resultado: { confirmado: true } });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    expect(executeTool).toHaveBeenCalledWith('confirmar_nascimento', { data: '20/05/1990' }, expect.any(Object));
    const { toolsRequested } = recordAiInteraction.mock.calls[0][0];
    expect(toolsRequested).toEqual([{ nome: 'confirmar_nascimento', args: { data: '[data]' } }]);
    const gravado = JSON.stringify(toolsRequested);
    expect(gravado).not.toContain('1990');
    expect(gravado).not.toContain('20/');
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
    client: { id: 9, document: '11122233344' }, dataNascimento: '1990-05-20', contestado: false, nascimentoTentado: false,
  };
  const TRIAGEM = { threshold: 0.8, maxQuestions: 2, attempts: 0, forcarConclusao: false };

  beforeEach(() => {
    // triageRequireBirthdate: true em quase todo este bloco — ele descreve a
    // triagem COM a confirmação por data de nascimento. O padrão de produção
    // (desligada) tem bloco próprio mais abaixo.
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: 'Seja breve.', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null, triageRequireBirthdate: true });
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
    // de onze) pode vazar para a triagem por engano.
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

    test('o bloco noturno do prompt cita a hora de retorno e proíbe prometer solução imediata', async () => {
      const sys = (await contexto({ triagem: NOTURNO })).messages[0].content;
      expect(sys).toMatch(/MODO NOTURNO/);
      expect(sys).toMatch(/A equipe volta às 08:00/);
      expect(sys).toMatch(/Nunca prometa solução imediata/);
      expect(sys).toMatch(/nossa equipe dá continuidade a partir das 08:00/);
    });

    test('o roteiro do comprovante só existe à noite', async () => {
      const sys = (await contexto({ triagem: NOTURNO })).messages[0].content;
      expect(sys).toMatch(/COMPROVANTE À NOITE/);
      expect(sys).toMatch(/chame analisar_comprovante/);
      expect(sys).toMatch(/NUNCA diga "pagamento confirmado" nem "acesso liberado"/);
      // O contrato do uso anterior é de outro cliente: à noite, como de dia, o
      // cliente ouve o mesmo acolhimento e nada mais.
      expect(sys).toMatch(/jaUtilizado/);
      expect(sys).toMatch(/NÃO diga isso ao cliente nem cite outro contrato/);
      jest.clearAllMocks();
      createChatCompletion.mockResolvedValue({ message: { content: 'Oi' }, usage: {} });
      const dia = (await contexto()).messages[0].content;
      expect(dia).not.toMatch(/COMPROVANTE À NOITE/);
      expect(dia).not.toMatch(/chame analisar_comprovante/);
    });

    test('à noite o roteiro de conexão tem até duas etapas e o desfecho com a hora de retorno', async () => {
      const sys = (await contexto({ triagem: NOTURNO })).messages[0].content;
      expect(sys).toMatch(/CONEXÃO À NOITE/);
      expect(sys).toMatch(/desligar o equipamento da tomada, esperar 30 segundos e ligar de novo/);
      expect(sys).toMatch(/Vou deixar seu atendimento na fila do Suporte com tudo o que verificamos\. Nossa equipe dá continuidade a partir das 08:00/);
    });

    test('de dia o prompt não tem o bloco noturno', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).not.toMatch(/MODO NOTURNO/);
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
      triageRequireBirthdate: true, triageReadReceiptsDaytime: true,
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

    test('com a flag ligada, o prompt de dia manda chamar a ferramenta e nunca fala em desbloqueio', async () => {
      getAiConfig.mockResolvedValue(configLendoDeDia);
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/COMPROVANTE: se o cliente enviar uma imagem/);
      expect(sys).toMatch(/chame analisar_comprovante/);
      expect(sys).toMatch(/NÃO confirme pagamento nem prometa liberação/);
      // O cliente nunca pode ouvir que o comprovante dele "já foi utilizado":
      // isso é conversa da equipe, não do atendimento.
      expect(sys).toMatch(/NÃO diga isso ao cliente/);
      expect(sys).not.toMatch(/desbloqueio/i);
      expect(sys).not.toMatch(/MODO NOTURNO/);
      // A linha antiga ("pergunte se é um comprovante") sai: perguntar antes
      // de ler é justamente o que a flag elimina.
      expect(sys).not.toMatch(/pergunte se é um comprovante/);
    });

    test('com a flag desligada, o prompt de dia mantém a linha antiga', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Se o cliente enviou uma imagem, pergunte se é um comprovante/);
      expect(sys).not.toMatch(/chame analisar_comprovante/);
    });
  });

  test('o contexto traz setores com orientação, motivos, e identidade só com primeiro nome', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toContain('Financeiro');
    expect(sys).toContain('Boleto, PIX, cobrança.');
    expect(sys).toContain('r-1');
    expect(sys).toContain('João');
    expect(sys).toContain('RUA X');
    expect(sys).toMatch(/primeiro nome/i);
    // Teste real do Suporte: "vou encaminhar" sem concluir gastou um turno.
    expect(sys).toMatch(/chame concluir_triagem NA MESMA resposta em que avisa o cliente/);
    expect(sys).toContain('Seja breve.');
    expect(sys).not.toContain('1990');
    // Não é a PALAVRA "valor" que é proibida (ela aparece dentro da própria
    // regra "nunca diga... valores") — é um valor em R$ ou uma fatura em
    // aberto vazando de verdade para o texto do sistema.
    // Pega valor/vencimento INTERPOLADO no contexto, não a palavra dentro de
    // uma regra ("existe ou não fatura em aberto" é instrução, não dado).
    // Os preços de exemplo do roteiro COMERCIAL ("• 500 Mega por R$ 100/mês")
    // são texto fixo do prompt, não dado de fatura: saem antes da checagem.
    const semPlanosDeExemplo = sys.split('\n').filter((l) => !/Mega por R\$/.test(l)).join('\n');
    expect(semPlanosDeExemplo).not.toMatch(/R\$|\bvalor (da|de|em)\b|venc(e|imento) (em|dia) \d/i);
  });

  // I1 (review): o endereço só pode ser dito de volta ao cliente quando a
  // identidade já é FORTE — é o endereço do próprio cliente. Com identidade
  // fraca (CPF ainda não confirmado por data de nascimento) o endereço
  // pertence a quem quer que seja o dono do CPF digitado, que pode não ser
  // quem está no WhatsApp.
  test('com identidade forte, pode desambiguar contratos pelo endereço', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toContain('Rua X ou');
  });

  test('com identidade fraca, nunca cita endereço/plano/cadastro para desambiguar', async () => {
    const sys = (await contexto({ identidade: { ...IDENT_FORTE, nivel: 'fraca', origem: 'cpf' } })).messages[0].content;
    expect(sys).toContain('NUNCA cite endereço');
    expect(sys).not.toContain('Rua X ou');
  });

  // Defeito C (teste real 2026-09-14): o modelo citou "contrato 2354" e, com
  // um contrato só, ainda perguntou "qual contrato/endereço".
  test('com identidade fraca, o contexto não lista contratos — só a quantidade', async () => {
    const sys = (await contexto({ identidade: { ...IDENT_FORTE, nivel: 'fraca', origem: 'cpf' } })).messages[0].content;
    expect(sys).toContain('Contratos: 1');
    expect(sys).not.toContain('Contratos dele:');
    expect(sys).not.toContain('17402');
    expect(sys).not.toContain('600MB');
  });

  test('com identidade forte, os contratos continuam listados com endereço', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toContain('Contratos dele:');
    expect(sys).toContain('RUA X');
  });

  test('os dois níveis proíbem citar o número do contrato ao cliente', async () => {
    for (const nivel of ['forte', 'fraca']) {
      jest.clearAllMocks();
      createChatCompletion.mockResolvedValue({ message: { content: 'Oi' }, usage: {} });
      const sys = (await contexto({ identidade: { ...IDENT_FORTE, nivel, origem: nivel === 'forte' ? 'phone' : 'cpf' } })).messages[0].content;
      expect(sys).toContain('NUNCA cite o número do contrato ao cliente.');
    }
  });

  test('com um contrato só, os dois níveis mandam usá-lo sem perguntar qual', async () => {
    for (const nivel of ['forte', 'fraca']) {
      jest.clearAllMocks();
      createChatCompletion.mockResolvedValue({ message: { content: 'Oi' }, usage: {} });
      const sys = (await contexto({ identidade: { ...IDENT_FORTE, nivel, origem: nivel === 'forte' ? 'phone' : 'cpf' } })).messages[0].content;
      expect(sys).toContain('Contrato único: use-o sem perguntar qual.');
      // Unificado: a instrução aparece uma vez só, não duplicada por nível.
      expect(sys.split('Contrato único: use-o sem perguntar qual.').length - 1).toBe(1);
    }
  });

  test('com mais de um contrato, não há a instrução de contrato único', async () => {
    const dois = { ...IDENT_FORTE, contracts: [...IDENT_FORTE.contracts, { id: 17405, statusCode: 1, plan: '600MB', address: 'AV Y' }] };
    const sys = (await contexto({ identidade: dois })).messages[0].content;
    expect(sys).not.toContain('Contrato único');
  });

  // Print 1 (teste real 2026-09-14): quem JÁ é cliente e quer outro ponto caía
  // no roteiro de cliente novo, e a IA listava todas as cidades atendidas.
  test('o bloco COMERCIAL cobre quem já é cliente e não foi identificado', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toContain('Se ele disser que JÁ é cliente e quer outro ponto ou mudar de plano, identifique primeiro (CPF e data de nascimento) e use o roteiro de cliente identificado. Não liste todas as cidades atendidas: pergunte a cidade e o bairro dele e confirme só a dele.');
  });

  test('preço e cobertura vêm só das instruções adicionais, rotuladas como fonte única', async () => {
    // O admin cadastra cidades e planos no campo livre; a regra fixa precisa
    // apontar para ele em vez de mandar tudo para o Comercial.
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 8, triageExtraInstructions: 'PLANOS:\n- 500 Mega — R$ 100,00 por mês', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2 });
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/SOMENTE o que estiver escrito nas INSTRUÇÕES ADICIONAIS/);
    expect(sys).toContain('INSTRUÇÕES ADICIONAIS DA OPERAÇÃO (única fonte para preço, planos e cobertura):');
    expect(sys).toContain('500 Mega — R$ 100,00 por mês');
    expect(sys).not.toMatch(/preços ou cobertura são com o Comercial/);
  });

  test('sem instruções adicionais, preço e cobertura ficam com o Comercial', async () => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 8, triageExtraInstructions: '', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2 });
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/Não há instruções adicionais da operação/);
  });

  test('identidade forte proíbe pedir CPF ou data de nascimento e manda dizer quando não há fatura', async () => {
    // Observado em produção: cliente identificado pelo telefone foi cobrado da
    // data de nascimento e depois encaminhado sem saber que não havia boleto.
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/NÃO peça CPF nem data de nascimento/);
    // Round 2026-09-13: a instrução passou a falar de "nenhum contrato" (a
    // ferramenta agora procura em todos) e a exigir concluir_triagem na mesma
    // resposta, em vez de perguntar se o cliente quer ser encaminhado.
    expect(sys).toMatch(/não há fatura em aberto em nenhum contrato, diga isso/i);
    expect(sys).toMatch(/chame concluir_triagem para o Financeiro na mesma resposta/i);
    expect(sys).toMatch(/contratosComFatura/);
    expect(sys).toMatch(/nunca repita/i);
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

  test('identidade none instrui a pedir CPF só se o setor exigir', async () => {
    const sys = (await contexto({ identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] } })).messages[0].content;
    expect(sys).toMatch(/não identificado/i);
    expect(sys).toMatch(/Comercial/);
  });

  // Teste real de 2026-09-13: cliente ja vinculado ouviu "me informe seu CPF"
  // porque o SGP nao respondeu. Com sgpIndisponivel a identidade continua
  // valendo — o que cai sao as consultas que dependem do SGP.
  test('SGP indisponível: cumprimenta pelo nome da memória, sem pedir CPF e sem prometer consulta', async () => {
    const sys = (await contexto({
      identidade: {
        nivel: 'forte', origem: 'memory', primeiroNome: 'Willemberg', contracts: [],
        client: { id: 9, document: '11122233344' }, dataNascimento: null,
        contestado: false, nascimentoTentado: false, sgpIndisponivel: true,
      },
    })).messages[0].content;
    expect(sys).toContain('NÃO peça CPF');
    expect(sys).toContain('SGP indisponível na triagem');
    expect(sys).toContain('Willemberg');
    expect(sys).not.toContain('me informe seu CPF');
    // O ramo de identidade para por aqui: nada de contratos nem de entregar
    // boleto/PIX, que precisariam do SGP que acabou de falhar.
    expect(sys).not.toMatch(/Identidade JÁ confirmada/);
  });

  test('SGP indisponível sem nome guardado não escreve "null" no contexto', async () => {
    const sys = (await contexto({
      identidade: { nivel: 'forte', origem: 'memory', primeiroNome: null, contracts: [], sgpIndisponivel: true },
    })).messages[0].content;
    expect(sys).toContain('primeiro nome cliente');
    expect(sys).not.toContain('primeiro nome null');
  });

  test('identidade fraca instrui a confirmar nascimento antes de entregar', async () => {
    const sys = (await contexto({ identidade: { ...IDENT_FORTE, nivel: 'fraca', origem: 'cpf' } })).messages[0].content;
    expect(sys).toMatch(/confirmar_nascimento/);
  });

  // Defeito A: com a identidade fraca chegando já pronta do resolvedor, o
  // modelo não precisa (e não deve) chamar buscar_cliente de novo.
  test('identidade fraca proíbe pedir o CPF outra vez', async () => {
    const sys = (await contexto({ identidade: { ...IDENT_FORTE, nivel: 'fraca', origem: 'cpf' } })).messages[0].content;
    expect(sys).toContain('O CPF já foi informado; NÃO peça o CPF de novo.');
  });

  // Minor (revisão final do branch inteiro): um cliente identificado (nível
  // != none) mas sem primeiroNome no cadastro não pode virar "primeiro nome
  // null" no contexto — o modelo repetiria isso de volta ao cliente.
  test('identidade forte sem primeiroNome usa "cliente" em vez de null no contexto', async () => {
    const sys = (await contexto({ identidade: { ...IDENT_FORTE, primeiroNome: null } })).messages[0].content;
    expect(sys).toContain('primeiro nome cliente.');
    expect(sys).not.toContain('primeiro nome null');
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
        triageRequireBirthdate: true,
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
        triageRequireBirthdate: true,
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

  describe('com a data de nascimento dispensada (padrão)', () => {
    beforeEach(() => {
      getAiConfig.mockResolvedValue({
        apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
        maxToolsPerInteraction: 8, triageExtraInstructions: 'Seja breve.',
        triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: null,
        triageRequireBirthdate: false,
      });
    });

    // Descrever ao modelo uma ferramenta que não serve para nada é o jeito
    // conhecido de ele afirmar que a usou.
    test('confirmar_nascimento sai da lista de ferramentas da triagem', async () => {
      const nomes = (await contexto()).tools.map((t) => t.function.name).sort();
      expect(nomes).not.toContain('confirmar_nascimento');
      expect(nomes).toEqual(FERRAMENTAS_TRIAGEM.filter((n) => n !== 'confirmar_nascimento').sort());
    });

    test('o prompt só fala em data de nascimento para PROIBIR que ela seja pedida', async () => {
      const sys = (await contexto()).messages[0].content;
      // Print 2026-09-17: a IA pediu a data mesmo com a exigência desligada,
      // então a única menção que sobrou é a proibição explícita.
      expect(sys).toMatch(/NUNCA peça data de nascimento/);
      expect(sys.replace(/NUNCA peça data de nascimento[^\n]*/g, '')).not.toMatch(/data de nascimento/i);
      // A linha do cliente ainda não identificado continua: o CPF segue sendo
      // o que identifica.
      const semIdentidade = (await (async () => {
        createChatCompletion.mockClear();
        return contexto({ identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] } });
      })()).messages[0].content;
      expect(semIdentidade).toContain('Cliente NÃO identificado.');
      expect(semIdentidade.replace(/NUNCA peça data de nascimento[^\n]*/g, '')).not.toMatch(/data de nascimento/i);
    });
  });

  test('com a exigência ligada, confirmar_nascimento continua na lista', async () => {
    const nomes = (await contexto()).tools.map((t) => t.function.name).sort();
    expect(nomes).toEqual([...FERRAMENTAS_TRIAGEM].sort());
    expect(nomes).toContain('confirmar_nascimento');
  });

  test('não vaza cpf, login pppoe, sobrenome nem data de nascimento no contexto de sistema', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).not.toContain('11122233344');
    expect(sys).not.toContain('pppoe');
    expect(sys).not.toContain('Silva');
    expect(sys).not.toContain('1990');
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

  test('com mais de um contrato, manda consultar as faturas de todos antes de perguntar', async () => {
    const doisContratos = { ...IDENT_FORTE, contracts: [
      { id: 17402, statusCode: 1, plan: '600MB', address: 'RUA X', login: 'a' },
      { id: 17405, statusCode: 1, plan: '300MB', address: 'AV Y', login: 'b' },
    ] };
    const sys = (await contexto({ identidade: doisContratos })).messages[0].content;
    expect(sys).toMatch(/chame consultar_faturas_todos_contratos ANTES de perguntar/);
    expect(sys).toMatch(/Se só um contrato tiver fatura em aberto, entregue dele sem perguntar/);
    expect(sys).toMatch(/nem pergunte "qual contrato"/);
  });

  test('com um contrato só, não fala em consultar as faturas de todos', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).not.toMatch(/consultar_faturas_todos_contratos ANTES/);
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

  // Prints 2026-09-16 (dois atendimentos reais): "minha internet não pega no
  // canto da rua" virou roteiro de falha + encaminhamento sem explicar nada, e
  // "quero a senha do meu vizinho" virou chamado no Suporte. Encaminhar tinha
  // virado a saída padrão para tudo.
  describe('atender em vez de encaminhar', () => {
    test('alcance do Wi-Fi não é falha de conexão e tem roteiro próprio', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/ALCANCE DO WI-FI/);
      expect(sys).toMatch(/perda de sinal ao se AFASTAR/);
      expect(sys).toMatch(/NÃO é falha de conexão/);
      expect(sys).toMatch(/O Wi-Fi tem alcance limitado/);
      expect(sys).toMatch(/Dentro de casa, perto do equipamento, a internet está funcionando bem\?/);
      expect(sys).toMatch(/Nunca prometa visita técnica nem equipamento/);
      expect(sys).toMatch(/siga exatamente o que está lá; se não disserem nada, não ofereça nada/);
    });

    test('pedido de dado de outra pessoa é recusado na hora e nunca vira chamado', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/DADOS DE OUTRA PESSOA/);
      expect(sys).toMatch(/NUNCA são passados e NUNCA viram chamado/);
      expect(sys).toMatch(/Não consigo passar dados de outro cliente, nem a senha da rede dele/);
      expect(sys).toMatch(/Posso te ajudar com alguma coisa do seu contrato\?/);
      expect(sys).toMatch(/Pedido de dado de outra pessoa; recusado na triagem/);
    });

    test('a regra de responder antes de encaminhar vale para todos os fluxos', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Nunca encaminhe deixando a pergunta dele sem resposta/);
      expect(sys).toMatch(/"Vou encaminhar" sozinho, sem nada antes, é atendimento ruim/);
    });

    test('o esclarecimento não anuncia o encaminhamento', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/pergunte direto o que você precisa saber/);
      expect(sys).toMatch(/nunca "me diga qual problema para eu encaminhar ao setor correto"/);
    });
  });

  // Quatro prints 2026-09-16: o roteiro de Suporte disparava para tudo
  // ("posso mudar o roteador de lugar?" abriu com "contrato ativo e conexão
  // online") e atropelava o relato ("contratei 500 mega e aparece 20" recebeu
  // "está sem acesso, com lentidão ou caindo?").
  describe('Suporte: dúvida não é falha, e nunca repetir o que o cliente já disse', () => {
    test('dúvida não consulta nem cita status', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/DÚVIDA não é falha/);
      expect(sys).toMatch(/NÃO chame status, NÃO cite status/);
    });

    test('problema já relatado pula a pergunta de diagnóstico', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Se o cliente JÁ disse qual é o problema/);
      expect(sys).toMatch(/Perguntar o que ele acabou de dizer é o pior erro de atendimento/);
    });

    test('velocidade abaixo da contratada tem roteiro próprio, com teste de velocidade', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/VELOCIDADE ABAIXO DA CONTRATADA/);
      expect(sys).toMatch(/entregue até o equipamento e medida por cabo/);
      expect(sys).toMatch(/você consegue fazer um teste de velocidade perto do equipamento\?/);
      expect(sys).toMatch(/NUNCA diga que a velocidade está correta sem teste/);
    });

    test('reembolso e desconto não são prometidos nem recusados pela IA', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/REEMBOLSO, DESCONTO OU ABATIMENTO: nunca prometa e nunca recuse/);
      expect(sys).toMatch(/Cliente pediu reembolso\/desconto/);
    });

    test('mudar o equipamento de lugar é respondido direto, sem status', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/MUDAR O EQUIPAMENTO DE LUGAR: responda direto, sem consultar status/);
      expect(sys).toMatch(/Pode sim, e você mesma pode fazer/);
      expect(sys).toMatch(/se ela só queria saber se pode, não encaminhe/);
    });

    test('alcance de Wi-Fi normal não abre chamado', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/está tudo normal: NÃO abra chamado/);
      expect(sys).toMatch(/Só conclua para o Suporte se ele quiser melhorar o alcance/);
      // O fecho antigo, que mandava concluir sempre, saiu.
      expect(sys).not.toMatch(/conclua para o Suporte com "alcance de Wi-Fi" no resumo, sem prometer/);
    });

    test('fim de roteiro não é automático', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Fim de roteiro NÃO é automático/);
      expect(sys).toMatch(/só conclua quando não houver mais nada para responder/);
      expect(sys).not.toMatch(/Depois da resposta dele, conclua para o Suporte com o relato no resumo\./);
    });
  });

  // Três prints 2026-09-16 (já com o roteiro do dia no ar): onde não existe
  // roteiro, a IA encaminha seco ou cai no modelo errado.
  describe('roteiros que faltavam', () => {
    test('mudança de endereço tem roteiro no Comercial', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/MUDANÇA DE ENDEREÇO/);
      expect(sys).toMatch(/transferência do ponto/);
      expect(sys).toMatch(/me diz o novo endereço \(cidade, bairro e rua\) e a data prevista da mudança/);
      expect(sys).toMatch(/NÃO encaminhe sem pedir isso/);
    });

    test('problema sem roteiro específico não cai na lista fixa de diagnóstico', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/PROBLEMA JÁ RELATADO SEM ROTEIRO PRÓPRIO/);
      expect(sys).toMatch(/repita o problema com as palavras dele/);
      expect(sys).toMatch(/UMA pergunta que faça sentido para AQUELE problema/);
      expect(sys).toMatch(/vídeo travando ou não carregando/);
      expect(sys).toMatch(/só nesse aplicativo ou em tudo/);
    });

    test('fatura de outra pessoa: entrega com o CPF do titular, sem virar dona do contato', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/FATURA, BOLETO OU PIX DE OUTRA PESSOA/);
      expect(sys).toMatch(/chame buscar_cliente com titularEOutraPessoa: true/);
      expect(sys).toMatch(/NUNCA diga "seu contrato"/);
    });
  });

  // Lote de prints 2026-09-16 (15:01–15:41), todos já com os roteiros do dia
  // no ar: gatilho cego da regra de terceiros, conclusão junto com pergunta,
  // funcionamento interno exposto e roteiros que ainda faltavam.
  describe('lote de correções da tarde', () => {
    test('a recusa de dado de terceiro só vale para PEDIDO de dado, não para relato', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/só quando ele PEDIR um dado de outra pessoa/);
      expect(sys).toMatch(/Relatar problema do vizinho .* NÃO é pedido de dado/);
      expect(sys).toMatch(/a senha da rede DELE mesmo, do contrato dele, é pedido legítimo/);
    });

    test('nunca concluir no mesmo turno em que pede algo ao cliente', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/NUNCA chame concluir_triagem no mesmo turno em que você pede alguma coisa ao cliente/);
      expect(sys).toMatch(/depois que ele responder/);
    });

    test('nunca expor funcionamento interno', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/NUNCA cite o funcionamento interno/);
      expect(sys).toMatch(/"aqui na triagem"/);
    });

    test('Reativação a partir de mais de 90 dias de atraso', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/REATIVAÇÃO/);
      expect(sys).toMatch(/mais de 90 dias em atraso/);
      expect(sys).toMatch(/nunca invente promoção, desconto ou valor/);
    });

    test('pode dizer há quanto tempo a fatura está em atraso, com identidade confirmada', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/pode dizer há quantos dias\/meses a fatura está vencida/);
      expect(sys).toMatch(/Hoje é /);
    });

    test('quitando o débito a internet volta, sem prazo prometido', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/assim que o pagamento for confirmado, o acesso é liberado automaticamente/);
      expect(sys).toMatch(/NUNCA prometa prazo/);
    });

    test('senha e QR code do Wi-Fi do próprio cliente: explica e encaminha', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/SENHA OU QR CODE DO WI-FI DO PRÓPRIO CLIENTE/);
      expect(sys).toMatch(/a senha fica no equipamento/);
    });

    test('lentidão em horário de pico tem roteiro', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/PIORA EM HORÁRIO CERTO/);
      expect(sys).toMatch(/quantos aparelhos costumam estar usando nesse horário/);
    });

    test('equipamento na casa de outra pessoa e dados móveis', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/EQUIPAMENTO NA CASA DE OUTRA PESSOA/);
      expect(sys).toMatch(/DADOS MÓVEIS \(2G, 3G, 4G, 5G\)/);
      expect(sys).toMatch(/não está usando a internet da casa/);
    });
  });

  // Print 2026-09-17 (18:25): cliente COM contrato perguntou "normalizou o
  // sinal da internet? estou perguntando pq não estou em Cândido Mendes" e
  // recebeu a tabela de planos inteira — a IA leu a cidade como pergunta de
  // cobertura e disparou o roteiro de cliente novo.
  describe('acompanhamento de falha não é pergunta de cobertura', () => {
    test('a tabela de planos é só para cliente não identificado', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/A tabela de planos é SÓ para cliente NÃO identificado/);
      expect(sys).toMatch(/Cliente com contrato nunca recebe a lista de planos/);
    });

    test('perguntar se o sinal normalizou é acompanhamento de falha', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/JÁ NORMALIZOU\?/);
      expect(sys).toMatch(/não é pergunta de cobertura/);
      expect(sys).toMatch(/consultar_status_todos_contratos/);
      expect(sys).toMatch(/citar a cidade não transforma o assunto em cobertura/);
    });
  });

  test('o pedido de CPF acolhe antes de pedir o documento', async () => {
    const sys = (await contexto({ identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] } })).messages[0].content;
    expect(sys).toContain('"Vou verificar isso para você. Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor."');
  });

  // Print 2026-09-17 (18:11): o dono reescreveu o modelo de "ativo e online" —
  // a versão antiga tinha virado uma frase decorada, longa e impessoal.
  test('o modelo de contrato ativo e conexão online usa a redação do dono, em três parágrafos', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toContain('Entendi. Vou verificar isso com você.');
    expect(sys).toContain('Consultei seu cadastro e, neste momento, seu contrato está ativo e sua conexão aparece online.');
    expect(sys).toContain('Me diz só uma coisa: você está sem internet, com lentidão ou a conexão está caindo?');
    // A redação antiga saiu inteira.
    expect(sys).not.toMatch(/Mesmo assim, você pode estar enfrentando alguma dificuldade/);
    expect(sys).not.toMatch(/está totalmente sem acesso/);
  });

  // Print 2026-09-17 (17:53): cliente mandou o comprovante e a IA respondeu
  // "Para seguir com a conferência, preciso confirmar a titularidade com a
  // data de nascimento" — com a confirmação por data DESLIGADA, ou seja, sem
  // nem ter como conferir a data. O prompt já proibia e foi ignorado.
  test('comprovante de cliente não identificado pede o CPF primeiro', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/COMPROVANTE DE CLIENTE NÃO IDENTIFICADO: peça o CPF ou CNPJ primeiro/);
    expect(sys).toMatch(/Sem o cadastro localizado não há o que conferir/);
  });

  describe('guarda contra pedir data de nascimento', () => {
    const IDENT = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [] };
    const SEM_EXIGENCIA = {
      apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
      maxToolsPerInteraction: 8, triageExtraInstructions: '', triageConfidenceThreshold: 0.8,
      triageMaxQuestions: 2, triageResolvedReasonId: null, triageRequireBirthdate: false,
    };

    test('pediu a data sem a ferramenta na lista: refaz a resposta', async () => {
      getAiConfig.mockResolvedValue(SEM_EXIGENCIA);
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Boa tarde! Para seguir com a conferência, preciso confirmar a titularidade com a data de nascimento.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Boa tarde! Para localizar seu cadastro, me informe seu CPF, por favor.' }, usage: {} });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(r.texto).toBe('Boa tarde! Para localizar seu cadastro, me informe seu CPF, por favor.');
      const segunda = createChatCompletion.mock.calls[1][0];
      expect(segunda.tools).toEqual([]);
      expect(segunda.messages[segunda.messages.length - 1].content).toMatch(/Você pediu a data de nascimento/);
    });

    test('se a reescrita ainda pedir, a frase da data é cortada', async () => {
      getAiConfig.mockResolvedValue(SEM_EXIGENCIA);
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Boa tarde! Para seguir, preciso da data de nascimento. Me informe seu CPF, por favor.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Preciso da data de nascimento. Me informe seu CPF, por favor.' }, usage: {} });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(r.texto).toBe('Me informe seu CPF, por favor.');
      expect(r.texto).not.toMatch(/nascimento/i);
    });

    test('com a exigência ligada (ferramenta na lista), pedir a data é legítimo', async () => {
      createChatCompletion.mockResolvedValue({ message: { content: 'Me informe sua data de nascimento, por favor.' }, usage: {} });

      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(r.texto).toBe('Me informe sua data de nascimento, por favor.');
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });

    test('texto sem menção à data não gera chamada extra', async () => {
      getAiConfig.mockResolvedValue(SEM_EXIGENCIA);
      createChatCompletion.mockResolvedValue({ message: { content: 'Me informe seu CPF, por favor.' }, usage: {} });

      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT, triagem: TRIAGEM, origemMensagem: 'texto' });

      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });
  });

  // Print 2026-09-17 (16:56): entrega de boleto inteira sem chamar a cliente
  // pelo nome, mesmo depois de identificar pelo CPF. "Está muito robô."
  test('depois de identificar, a IA trata o cliente pelo primeiro nome', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/Assim que souber o primeiro nome do cliente .* use o nome dele/);
    expect(sys).toMatch(/Entregar boleto, PIX ou resposta sem nunca chamar a pessoa pelo nome soa robótico/);
  });

  // Print 2026-09-17 (16:32): "quero pagar minha internet" + CPF → a IA
  // respondeu com o roteiro do contrato suspenso e perguntou "você chegou a
  // fazer esse pagamento?". Ela acabou de dizer que QUER pagar.
  describe('pedido de pagamento tem prioridade', () => {
    test('quem pede para pagar recebe a entrega, não o roteiro do suspenso', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/PEDIDO DE PAGAMENTO .* tem prioridade sobre qualquer roteiro de diagnóstico/);
      expect(sys).toMatch(/entregue o boleto ou o PIX AGORA/);
      expect(sys).toMatch(/NUNCA pergunte "você chegou a fazer esse pagamento\?" a quem acabou de dizer que quer pagar/);
    });

    test('o roteiro do suspenso fica restrito a quem relata falta de acesso', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/só quando ele RELATAR falta de acesso/);
    });
  });

  // Print 2026-09-17 (16:05–16:06): a mesma pergunta de diagnóstico saiu três
  // vezes seguidas, mesmo com o cliente respondendo "Lentidão" no meio.
  describe('nunca repetir a mesma mensagem', () => {
    test('o prompt proíbe repetir mensagem já enviada na conversa', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/NUNCA repita uma mensagem que você já enviou nesta conversa/);
      expect(sys).toMatch(/Se ele já respondeu a sua pergunta, siga em frente/);
    });

    test('resposta de diagnóstico tem para onde ir', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Quando ele responder à pergunta de diagnóstico/);
      expect(sys).toMatch(/"lentidão" ou "está lento"/);
      expect(sys).toMatch(/roteiro de VELOCIDADE ABAIXO DA CONTRATADA/);
    });
  });

  // Prints 2026-09-17, três correções pedidas pelo dono.
  describe('correções de 2026-09-17', () => {
    test('com a exigência desligada (padrão da operação), o prompt PROÍBE pedir data de nascimento', async () => {
      getAiConfig.mockResolvedValue({
        apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.',
        maxToolsPerInteraction: 8, triageExtraInstructions: '', triageConfidenceThreshold: 0.8,
        triageMaxQuestions: 2, triageResolvedReasonId: null, triageRequireBirthdate: false,
      });
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/NUNCA peça data de nascimento/);
      expect(sys).toMatch(/nem para conferir comprovante/);
    });

    test('com a exigência ligada, a proibição não aparece', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).not.toMatch(/NUNCA peça data de nascimento/);
    });

    test('Reativação passa a ser mais de 90 dias de atraso', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/mais de 90 dias em atraso/);
      expect(sys).not.toMatch(/DOIS meses ou mais em atraso/);
    });

    test('documentos para fazer o cadastro saem das instruções da operação', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/O QUE PRECISA PARA FAZER O CADASTRO/);
      expect(sys).toMatch(/responda com a lista exatamente como está lá/);
      expect(sys).toMatch(/NÃO encaminhe sem responder/);
    });

    test('nome de outra pessoa citado pelo cliente exige titularEOutraPessoa', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Se ele citar o NOME de outra pessoa/);
      expect(sys).toMatch(/nunca chame quem está falando pelo nome do titular/);
    });
  });

  // Print 2026-09-16: "Bom dia!" em toda resposta da mesma conversa.
  test('o prompt manda cumprimentar só na primeira resposta', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/Cumprimente só na primeira resposta da conversa; nas seguintes, não repita a saudação/);
  });

  test('o fluxo de Comercial traz os dois roteiros do dono e a regra de listar os planos das instruções', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/COMERCIAL \(cobertura, planos, contratar, mudar de plano\)/);
    expect(sys).toMatch(/Que bom ter você por aqui 😊/);
    expect(sys).toMatch(/• 500 Mega por R\$ 100\/mês/);
    expect(sys).toMatch(/Para verificar a disponibilidade no seu endereço, me informe seu bairro e sua rua\./);
    expect(sys).toMatch(/vou te ajudar a conhecer nossos planos 😊/);
    expect(sys).toMatch(/encaminho para o Comercial verificar a alteração no seu contrato/);
    expect(sys).toMatch(/Nunca peça CPF de cliente novo/);
    expect(sys).toMatch(/Se a cidade NÃO estiver na lista de cobertura, diga que o Comercial confirma/);
    // Emoji liberado no PIX e no Comercial; boleto e Suporte seguem sem.
    expect(sys).toMatch(/SÓ nos fluxos do PIX e do COMERCIAL/);
  });

  // Teste real 2026-09-15 (print do dono): a IA pediu bairro/rua três vezes,
  // e quando o cliente perguntou "qual é o melhor?" encaminhou sem responder.
  // Roteiro ditado pelo dono: endereço é UMA pergunta (bairro e rua juntos),
  // confirma o que veio e pede só o que falta uma vez; pergunta pendente é
  // respondida antes de encaminhar; frases de encaminhamento de dia e de noite.
  describe('roteiro COMERCIAL de cliente novo (2026-09-15)', () => {
    test('abertura no modelo do dono, planos copiados das instruções, endereço numa pergunta só', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/copie o bloco de planos EXATAMENTE como está escrito nas instruções/);
      expect(sys).toMatch(/Temos planos de internet 100% fibra óptica:/);
      expect(sys).toMatch(/Instalação grátis\./);
      expect(sys).toMatch(/atendemos em TODOS os bairros e ruas dela/);
      expect(sys).toMatch(/Endereço é UMA pergunta só \(bairro e rua juntos\)/);
      expect(sys).toMatch(/Perfeito, Centro de Godofredo Viana 👍 Qual é a rua onde deseja instalar\?/);
      expect(sys).toMatch(/Nunca peça a mesma coisa uma terceira vez/);
      expect(sys).toMatch(/Não é preciso ter o endereço completo para encaminhar/);
      // O antigo modelo com a lista fixa de planos do cliente NOVO saiu: os
      // planos são só os das instruções.
      expect(sys).not.toMatch(/Atendemos em Godofredo Viana e temos estas opções/);
      expect(sys).not.toMatch(/Algum desses planos chamou sua atenção\?/);
    });

    test('"qual é o melhor?": recomenda pelo critério das instruções ou explica e pergunta o uso; nunca encaminha sem responder', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Se ele perguntar qual plano é o melhor ou pedir indicação/);
      expect(sys).toMatch(/recomende um plano com uma frase de motivo/);
      expect(sys).toMatch(/a diferença é só a velocidade/);
      expect(sys).toMatch(/Nunca encaminhe deixando uma pergunta dele sem resposta/);
    });

    // Print 2026-09-15 (21:16): "vocês tem internet em Viseu?" → "Atendemos em
    // Viseu. Certo! Vou encaminhar você para o Comercial." Confirmou e
    // encaminhou na primeira resposta, sem planos nem endereço — e com um
    // "Certo!" que não respondia a pedido nenhum.
    test('pergunta de cobertura de cliente novo: confirma e emenda a venda; encaminha só no momento certo', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/Pergunta de cobertura de cliente novo \("tem internet em X\?"\): responda "Atendemos em X!" e, NA MESMA mensagem, emende a abertura/);
      expect(sys).toMatch(/NUNCA encaminhe um cliente novo na primeira resposta/);
      expect(sys).toMatch(/Encaminhe ao Comercial SOMENTE quando: ele escolher um plano ou pedir para contratar; ou já tiver dado o endereço; ou pedir para falar com um atendente; ou a cidade não estiver na lista/);
      expect(sys).toMatch(/O "Certo!" do modelo é só quando ele pediu algo \(contratar, falar com atendente\); senão comece direto em "Vou encaminhar/);
    });

    test('de dia, o encaminhamento ao Comercial usa a frase do dia', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toContain('"Certo! 😊 Vou encaminhar você para o Comercial. Um atendente continuará o atendimento por aqui."');
      expect(sys).not.toMatch(/fora do horário de atendimento, mas sua conversa ficará registrada/);
    });

    test('à noite, o encaminhamento ao Comercial usa a frase da noite', async () => {
      const sys = (await contexto({ triagem: { ...TRIAGEM, noturno: { ativo: true, retornoAs: '08:00' } } })).messages[0].content;
      expect(sys).toContain('"Certo! 😊 Vou encaminhar seu atendimento para nossa equipe Comercial. No momento estamos fora do horário de atendimento, mas sua conversa ficará registrada e nossa equipe continuará por aqui assim que o expediente iniciar."');
      expect(sys).not.toMatch(/Um atendente continuará o atendimento por aqui/);
    });

    test('emoji no Comercial: ícone por plano e 👍 liberados; boleto e Suporte seguem sem', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/SÓ nos fluxos do PIX e do COMERCIAL/);
      expect(sys).toMatch(/No COMERCIAL.*um ícone por plano.*👍/);
      expect(sys).toMatch(/NENHUM emoji — nem na saudação/);
    });

    test('conclusão forçada pelo limite responde a pergunta pendente antes de encaminhar', async () => {
      const sys = (await contexto({ triagem: { ...TRIAGEM, attempts: 5, forcarConclusao: true } })).messages[0].content;
      expect(sys).toMatch(/LIMITE DE PERGUNTAS ATINGIDO/);
      expect(sys).toMatch(/Se ele fez uma pergunta nesta mensagem, responda-a ANTES de dizer que está encaminhando/);
    });
  });

  test('o fluxo de Suporte traz os três roteiros do dono e manda consultar o status antes de responder', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/ANTES de responder, chame consultar_status_todos_contratos \(UMA chamada, cobre todos os contratos\) e siga a instrução que ela devolver/);
    // Redação reescrita pelo dono em 2026-09-17.
    expect(sys).toMatch(/seu contrato está ativo e sua conexão aparece online\./);
    expect(sys).toMatch(/você está sem internet, com lentidão ou a conexão está caindo\?/);
    expect(sys).toMatch(/sua conexão está offline no momento/);
    expect(sys).toMatch(/Tem alguma luz vermelha acesa ou piscando\?/);
    expect(sys).toMatch(/pendência na fatura que deixou o acesso à internet temporariamente suspenso/);
    expect(sys).toMatch(/Você chegou a fazer esse pagamento\?/);
    // A exceção de status vale só no Suporte com identidade confirmada.
    expect(sys).toMatch(/dizer o status do contrato e da conexão no fluxo de SUPORTE/);
    expect(sys).toMatch(/Sem identidade confirmada, o fluxo de Suporte não cita status nenhum/);
  });

  // Para o dono, "não consegui confirmar aqui o status da conexão... posso
  // encaminhar para o suporte verificar" é inaceitável: a empresa É o suporte.
  test('proíbe dizer ao cliente que não conseguiu verificar algo, citando a empresa cadastrada', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/NUNCA diga ao cliente que não conseguiu verificar, confirmar ou consultar algo/);
    expect(sys).toMatch(/a Provedor X é o suporte/);
    expect(sys).toMatch(/Se uma consulta falhar, responda com o que tem e encaminhe ao setor dizendo que a equipe verifica/);
  });

  // Sem empresa cadastrada a frase continua fazendo sentido — e nenhum nome
  // de provedor fica embutido no código.
  test('sem nome cadastrado, a frase cai no genérico "a empresa"', async () => {
    getCompanyConfig.mockResolvedValue({ id: null, name: '', acceptedPayeeNames: [] });
    const sys = (await contexto()).messages[0].content;
    expect(sys).toMatch(/a empresa é o suporte/);
    expect(sys).not.toMatch(/DW/);
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

  // Com o motivo de encerramento configurado, a triagem deixa de encaminhar o
  // cliente que só queria o boleto/PIX: ela mesma fecha o atendimento.
  describe('encerramento pela própria IA (triageResolvedReasonId configurado)', () => {
    const COM_MOTIVO = { apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: '', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageResolvedReasonId: 'rr-1' };

    test('com motivo, traz os modelos de frase da entrega e da despedida, e manda chamar encerrar_atendimento', async () => {
      getAiConfig.mockResolvedValue(COM_MOTIVO);
      const sys = (await contexto()).messages[0].content;
      // Modelos de frase pedidos pelo dono (2026-09-13). Os da ENTREGA saíram
      // do prompt (teste real 2026-09-15: o modelo copiou "Enviei acima o
      // boleto..." do exemplo sem chamar enviar_boleto): agora só a própria
      // ferramenta devolve o modelo, depois de enviar de verdade.
      expect(sys).toMatch(/responda EXATAMENTE no modelo que a ferramenta devolver no campo instrucao/);
      expect(sys).toMatch(/NUNCA diga que enviou o boleto ou o PIX antes de a ferramenta confirmar o envio/);
      expect(sys).not.toMatch(/Enviei acima o PIX/);
      expect(sys).not.toMatch(/Enviei acima o boleto/);
      expect(sys).not.toMatch(/Agenor Costa/);
      expect(sys).toMatch(/Imagina, Willemberg! 😊/);
      expect(sys).toMatch(/Tenha um ótimo dia!/);
      expect(sys).toMatch(/Se responder só "ok"/);
      expect(sys).toMatch(/No fluxo do BOLETO as mesmas despedidas valem, mas SEM emoji/);
      expect(sys).toMatch(/chame encerrar_atendimento/);
      expect(sys).toMatch(/Tom: caloroso e direto/);
      // Emoji só no PIX; no boleto nenhum, nem na saudação; e uma mensagem só,
      // sem colar o modelo depois da própria frase (2º teste real do boleto).
      expect(sys).toMatch(/SÓ nos fluxos do PIX e do COMERCIAL/);
      expect(sys).toMatch(/NENHUM emoji — nem na saudação/);
      expect(sys).toMatch(/Escreva UMA mensagem por resposta/);
      expect(sys).not.toMatch(/e depois conclua a triagem para o Financeiro/);
    });

    test('com mais de um contrato, o pedido de endereço segue o modelo de frase', async () => {
      getAiConfig.mockResolvedValue(COM_MOTIVO);
      const doisContratos = { ...IDENT_FORTE, contracts: [
        { id: 17402, statusCode: 1, plan: '600MB', address: 'RUA X', login: 'a' },
        { id: 17405, statusCode: 1, plan: '300MB', address: 'AV Y', login: 'b' },
      ] };
      const sys = (await contexto({ identidade: doisContratos })).messages[0].content;
      expect(sys).toMatch(/Vi que você tem mais de um contrato com a gente/);
      expect(sys).toMatch(/Claro, vou te ajudar com o boleto\. Vi que você tem mais de um contrato/);
    });

    test('sem motivo, continua encaminhando ao Financeiro como hoje', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).toMatch(/e depois conclua a triagem para o Financeiro/);
      expect(sys).not.toMatch(/chame encerrar_atendimento/);
    });

    test('no limite de perguntas com motivo, entrega e encerra em vez de concluir', async () => {
      getAiConfig.mockResolvedValue(COM_MOTIVO);
      const sys = (await contexto({ triagem: { ...TRIAGEM, attempts: 2, forcarConclusao: true } })).messages[0].content;
      expect(sys).toMatch(/LIMITE DE PERGUNTAS ATINGIDO/);
      expect(sys).toMatch(/entregue AGORA e chame encerrar_atendimento/);
    });
  });

  // A IA cumprimentava sem saudação ("vou encaminhar...") porque nada no
  // contexto dizia que horas são — o modelo não tem relógio.
  // Sem esta linha, a triagem pede reinício de equipamento a quem está no meio
  // de uma falha regional que a empresa já conhece.
  test('com aviso de cidade, o contexto traz o aviso e a instrução da falha regional', async () => {
    const sys = (await contexto({
      avisoCidade: { cidade: 'Cândido Mendes', mensagem: 'Rompimento de fibra; equipe em campo.' },
    })).messages[0].content;
    expect(sys).toContain('AVISO ATIVO NA CIDADE DO CLIENTE (Cândido Mendes): Rompimento de fibra; equipe em campo.');
    expect(sys).toMatch(/falha regional em andamento nessa cidade/);
    expect(sys).toMatch(/NÃO peça verificações de equipamento/);
    expect(sys).toMatch(/Se o assunto for outro, atenda normalmente/);
  });

  test('sem aviso de cidade, nenhuma das duas linhas aparece', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).not.toMatch(/AVISO ATIVO NA CIDADE DO CLIENTE/);
    expect(sys).not.toMatch(/falha regional em andamento/);
  });

  test('o contexto informa a hora de Brasília e a regra de saudação', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-13T13:05:00-03:00'));
    try {
      const sys = (await contexto()).messages[0].content;
      // A data entrou junto (2026-09-16): sem ela o modelo não conta os dias
      // de atraso da fatura.
      expect(sys).toContain('e agora são 13:05');
      expect(sys).toMatch(/Hoje é \d{2}\/\d{2}\/\d{4} e agora são 13:05/);
      expect(sys).toMatch(/Boa tarde/);
    } finally {
      jest.useRealTimers();
    }
  });

  test('encerrar_atendimento entra na lista fixa da triagem', async () => {
    expect(FERRAMENTAS_TRIAGEM).toContain('encerrar_atendimento');
    expect(FERRAMENTAS_TRIAGEM).toHaveLength(11);
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

  test('perfil assistente continua igual: sem identidade, ferramentas do cartão', async () => {
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });
    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });
    const req = createChatCompletion.mock.calls[0][0];
    expect(req.tools.map((t) => t.function.name)).toEqual(['desbloqueio_confianca']);
    expect(req.messages[0].content).not.toMatch(/recepcionista/i);
  });
});
