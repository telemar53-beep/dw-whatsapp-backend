jest.mock('./openai-client');
jest.mock('./tool-executor');
jest.mock('./ai-config.repository');
jest.mock('./ai-interaction.repository');
jest.mock('../conversations/message.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../sectors/sector.repository');
jest.mock('../integrations/sgp-client');

const { createChatCompletion } = require('./openai-client');
const { executeTool } = require('./tool-executor');
const { getAiConfig, listToolPermissions } = require('./ai-config.repository');
const { recordAiInteraction } = require('./ai-interaction.repository');
const { listRecentMessagesByConversation } = require('../conversations/message.repository');
const { listActiveReasons } = require('../reasons/reason.repository');
const { listSectors } = require('../sectors/sector.repository');
const { runAiTurn } = require('./ai-orchestrator');

const CONVERSATION = { id: 'c-1', channelId: 'ch-1' };
const CONTACT = { id: 'ct-1', sgpClientId: null, sgpContractId: null, sgpDocument: null };

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue({
    apiKey: 'sk', model: 'gpt-x', mode: 'assistant',
    systemPrompt: 'Você é a assistente da DW Telecom.', maxToolsPerInteraction: 8,
  });
  listToolPermissions.mockResolvedValue([{ toolName: 'consultar_plano', enabled: true }]);
  listRecentMessagesByConversation.mockResolvedValue([
    { direction: 'inbound', content: 'qual meu plano?', messageType: 'text' },
  ]);
  listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Lentidão' }]);
  listSectors.mockResolvedValue([{ id: 's-1', name: 'Suporte' }]);
  recordAiInteraction.mockResolvedValue({ id: 'i-1' });
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
