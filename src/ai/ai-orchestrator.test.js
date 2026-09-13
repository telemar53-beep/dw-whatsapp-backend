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
const sgpClient = require('../integrations/sgp-client');
const { runAiTurn, FERRAMENTAS_TRIAGEM } = require('./ai-orchestrator');

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
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', mode: 'assistant', systemPrompt: 'Você é a assistente.', maxToolsPerInteraction: 8, triageExtraInstructions: 'Seja breve.', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2 });
    listSectors.mockResolvedValue([{ id: 's-1', name: 'Financeiro', aiHint: 'Boleto, PIX, cobrança.' }, { id: 's-2', name: 'Suporte', aiHint: '' }]);
    listActiveReasons.mockResolvedValue([{ id: 'r-1', name: 'Segunda via' }]);
    listToolPermissions.mockResolvedValue([{ toolName: 'desbloqueio_confianca', enabled: true }]);
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
  });

  test('o contexto traz setores com orientação, motivos, e identidade só com primeiro nome', async () => {
    const sys = (await contexto()).messages[0].content;
    expect(sys).toContain('Financeiro');
    expect(sys).toContain('Boleto, PIX, cobrança.');
    expect(sys).toContain('r-1');
    expect(sys).toContain('João');
    expect(sys).toContain('RUA X');
    expect(sys).toMatch(/primeiro nome/i);
    expect(sys).toContain('Seja breve.');
    expect(sys).not.toContain('1990');
    // Não é a PALAVRA "valor" que é proibida (ela aparece dentro da própria
    // regra "nunca diga... valores") — é um valor em R$ ou uma fatura em
    // aberto vazando de verdade para o texto do sistema.
    // Pega valor/vencimento INTERPOLADO no contexto, não a palavra dentro de
    // uma regra ("existe ou não fatura em aberto" é instrução, não dado).
    expect(sys).not.toMatch(/R\$|\bvalor (da|de|em)\b|venc(e|imento) (em|dia) \d/i);
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
    expect(sys).toMatch(/não há fatura em aberto, diga isso/i);
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

  test('identidade fraca instrui a confirmar nascimento antes de entregar', async () => {
    const sys = (await contexto({ identidade: { ...IDENT_FORTE, nivel: 'fraca', origem: 'cpf' } })).messages[0].content;
    expect(sys).toMatch(/confirmar_nascimento/);
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

  test('encerrar_atendimento entra na lista fixa da triagem', async () => {
    expect(FERRAMENTAS_TRIAGEM).toContain('encerrar_atendimento');
    expect(FERRAMENTAS_TRIAGEM).toHaveLength(11);
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
