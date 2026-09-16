jest.mock('./ai-config.repository');
// Mock parcial: findTool é o que os testes controlam por caso; perfilTriagem
// fica com a implementação de verdade (minor, revisão final do branch
// inteiro — o executor agora importa perfilTriagem de tool-registry em vez
// de duplicar a lógica). Mocká-la também devolveria undefined em todo teste
// e derrubaria os testes de exigeIdentidadeForte, que dependem do
// discriminador de verdade (ferramentasPermitidas OU identidade).
jest.mock('./tool-registry', () => ({
  ...jest.requireActual('./tool-registry'),
  findTool: jest.fn(),
}));
jest.mock('../integrations/sgp-client');
jest.mock('../conversations/contact.repository');
const { isToolEnabled } = require('./ai-config.repository');
const { findTool } = require('./tool-registry');
const sgpClient = require('../integrations/sgp-client');
const { executeTool } = require('./tool-executor');

const CONTEXTO = {
  conversationId: 'c-1',
  contact: { id: 'ct-1', sgpDocument: '52998224725' },
  contracts: [{ id: 17402 }, { id: 17405 }],
};

function toolFake(overrides = {}) {
  return {
    nome: 'consultar_plano',
    categoria: 'CONSULTA',
    descricao: 'x',
    parametros: {},
    chaveProprietario: 'contratoId',
    validar: (args) => ({ ok: true, args }),
    executar: jest.fn().mockResolvedValue({ plano: '600MB' }),
    ...overrides,
  };
}

describe('tool-executor', () => {
  beforeEach(() => jest.clearAllMocks());

  test('refuses a tool that is not in the registry', async () => {
    findTool.mockReturnValue(null);
    const result = await executeTool('consultar_ip', { contratoId: 17402 }, CONTEXTO);
    expect(result).toEqual({ ok: false, motivo: 'unknown_tool', detalhe: 'consultar_ip' });
    expect(isToolEnabled).not.toHaveBeenCalled();
  });

  test('refuses a tool that is disabled in the permissions screen', async () => {
    findTool.mockReturnValue(toolFake());
    isToolEnabled.mockResolvedValue(false);
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO);
    expect(result.motivo).toBe('tool_disabled');
  });

  test('refuses arguments our own validator rejects', async () => {
    findTool.mockReturnValue(toolFake({ validar: () => ({ ok: false, erro: 'contratoId must be a positive integer' }) }));
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool('consultar_plano', { contratoId: 'abc' }, CONTEXTO);
    expect(result.motivo).toBe('invalid_args');
  });

  test('refuses a contract that does not belong to this contact', async () => {
    const tool = toolFake();
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool('consultar_plano', { contratoId: 99999 }, CONTEXTO);
    expect(result.motivo).toBe('contract_not_owned');
    expect(tool.executar).not.toHaveBeenCalled();
  });

  test('allows a contract that belongs to this contact', async () => {
    const tool = toolFake();
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO);
    expect(result).toEqual({ ok: true, resultado: { plano: '600MB' } });
  });

  test('buscar_cliente is exempt from the contract check but refuses switching client', async () => {
    const tool = toolFake({
      nome: 'buscar_cliente',
      validar: (args) => ({ ok: true, args: { cpf: args.cpf } }),
      executar: jest.fn().mockResolvedValue({ cliente: { nome: 'X' } }),
    });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);

    const mesmo = await executeTool('buscar_cliente', { cpf: '52998224725' }, CONTEXTO);
    expect(mesmo.ok).toBe(true);

    const outro = await executeTool('buscar_cliente', { cpf: '11122233344' }, CONTEXTO);
    expect(outro.motivo).toBe('client_already_identified');
  });

  // Print 2026-09-16: a cliente mandou o CPF do vizinho e a IA respondeu
  // "preciso do CPF do titular novamente", em looping — era esta trava
  // recusando, sem o modelo saber o motivo. Consultar o CPF de outra pessoa
  // (fatura do amigo, problema do vizinho) é pedido legítimo.
  test('buscar_cliente com titularEOutraPessoa passa mesmo com outro cliente já identificado', async () => {
    const tool = toolFake({
      nome: 'buscar_cliente',
      validar: (args) => ({ ok: true, args: { cpf: args.cpf, titularEOutraPessoa: args.titularEOutraPessoa === true } }),
      executar: jest.fn().mockResolvedValue({ cliente: { nome: 'Vizinho' } }),
    });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);

    const r = await executeTool('buscar_cliente', { cpf: '11122233344', titularEOutraPessoa: true }, CONTEXTO);

    expect(r.ok).toBe(true);
    expect(tool.executar).toHaveBeenCalled();
  });

  test('buscar_cliente is allowed freely when no client is identified yet', async () => {
    const tool = toolFake({ nome: 'buscar_cliente', executar: jest.fn().mockResolvedValue({ ok: 1 }) });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool(
      'buscar_cliente', { cpf: '11122233344' },
      { ...CONTEXTO, contact: { id: 'ct-1', sgpDocument: null }, contracts: [] }
    );
    expect(result.ok).toBe(true);
  });

  test('turns an execution error into a structured refusal instead of throwing', async () => {
    findTool.mockReturnValue(toolFake({ executar: jest.fn().mockRejectedValue(new Error('SGP down')) }));
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO);
    expect(result.motivo).toBe('execution_error');
  });

  test('times out a tool that hangs', async () => {
    findTool.mockReturnValue(toolFake({ executar: () => new Promise(() => {}) }));
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO, { timeoutMs: 20 });
    expect(result.motivo).toBe('timeout');
  }, 10000);

  test('refuses to let buscar_cliente switch customers mid-conversation, even starting from no document on file (regression: the real tool must persist the document it just identified)', async () => {
    // Usa o tool-registry de verdade (não o mock do topo do arquivo) porque o bug
    // vive lá: buscar_cliente.executar precisa persistir contexto.contact.sgpDocument
    // para que o guard de troca de cliente, aqui no executor, tenha o que conferir.
    const registroReal = jest.requireActual('./tool-registry');
    findTool.mockImplementation((nomeConsultado) => registroReal.findTool(nomeConsultado));
    isToolEnabled.mockResolvedValue(true);
    sgpClient.lookupClientByCpf
      .mockResolvedValueOnce({ client: { id: 'cli-a', name: 'Cliente A' }, contracts: [{ id: 1 }] })
      .mockResolvedValueOnce({ client: { id: 'cli-b', name: 'Cliente B' }, contracts: [{ id: 2 }] });

    const contexto = { conversationId: 'c-2', contact: { id: 'ct-2', sgpDocument: null }, contracts: [] };

    const primeira = await executeTool('buscar_cliente', { cpf: '11122233344' }, contexto);
    expect(primeira.ok).toBe(true);

    const segunda = await executeTool('buscar_cliente', { cpf: '52998224725' }, contexto);
    expect(segunda.motivo).toBe('client_already_identified');
  });

  test('turns a rejection from isToolEnabled into a structured refusal instead of throwing', async () => {
    findTool.mockReturnValue(toolFake());
    isToolEnabled.mockRejectedValue(new Error('connection refused'));
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO);
    expect(result.motivo).toBe('execution_error');
  });

  test('refuses a tool that declares neither chaveProprietario nor isentoDeProprietario', async () => {
    const tool = toolFake({ chaveProprietario: undefined });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO);
    expect(result.motivo).toBe('tool_misconfigured');
    expect(tool.executar).not.toHaveBeenCalled();
  });

  test('uses the sanitised args from validar for the ownership check and for executar, not the raw ones', async () => {
    const tool = toolFake({
      validar: (args) => ({ ok: true, args: { contratoId: Number(args.contratoId) } }),
    });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const result = await executeTool('consultar_plano', { contratoId: '17402' }, CONTEXTO);
    expect(result).toEqual({ ok: true, resultado: { plano: '600MB' } });
    expect(tool.executar).toHaveBeenCalledWith({ contratoId: 17402 }, CONTEXTO);
  });

  test('logs an SGP failure without leaking the raw error object (no token, no request body)', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const causaAxios = new Error('Request failed with status code 500');
    causaAxios.config = { data: 'token=SECRETO123&app=dw&cpfcnpj=52998224725' };
    const erroSgp = new Error('Failed to reach SGP at /api/ura/consultacliente');
    erroSgp.cause = causaAxios;
    findTool.mockReturnValue(toolFake({ executar: jest.fn().mockRejectedValue(erroSgp) }));
    isToolEnabled.mockResolvedValue(true);

    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO);

    expect(result.motivo).toBe('execution_error');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const argumentosLogados = consoleSpy.mock.calls[0];
    const textoLogado = JSON.stringify(argumentosLogados);
    expect(textoLogado).not.toContain('SECRETO123');
    expect(textoLogado).not.toContain('token=');
    argumentosLogados.forEach((arg) => expect(arg instanceof Error).toBe(false));

    consoleSpy.mockRestore();
  });
});

describe('tool-executor — perfil com lista fixa e identidade', () => {
  beforeEach(() => jest.clearAllMocks());

  test('com ferramentasPermitidas no contexto, a tabela de permissões é ignorada', async () => {
    findTool.mockReturnValue(toolFake());
    isToolEnabled.mockResolvedValue(false);
    const ctx = { ...CONTEXTO, ferramentasPermitidas: ['consultar_plano'] };
    expect((await executeTool('consultar_plano', { contratoId: 17402 }, ctx)).ok).toBe(true);
    expect(isToolEnabled).not.toHaveBeenCalled();
  });

  test('ferramenta fora da lista fixa é recusada mesmo ligada na tabela', async () => {
    const tool = toolFake();
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const ctx = { ...CONTEXTO, ferramentasPermitidas: ['buscar_cliente'] };
    const resultado = await executeTool('consultar_plano', { contratoId: 17402 }, ctx);
    expect(resultado.motivo).toBe('tool_not_in_profile');
    // I3 (fix round 1): a recusa tem que acontecer ANTES de executar() —
    // mover a checagem para depois deixaria os testes verdes sem barrar nada.
    expect(tool.executar).not.toHaveBeenCalled();
  });

  test('exigeIdentidadeForte recusa com identidade fraca e passa com forte', async () => {
    const tool = toolFake({ exigeIdentidadeForte: true });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const fraca = await executeTool('consultar_plano', { contratoId: 17402 }, { ...CONTEXTO, identidade: { nivel: 'fraca' } });
    expect(fraca.motivo).toBe('identity_not_confirmed');
    expect(tool.executar).not.toHaveBeenCalled();
    const forte = await executeTool('consultar_plano', { contratoId: 17402 }, { ...CONTEXTO, identidade: { nivel: 'forte' } });
    expect(forte.ok).toBe(true);
  });

  // Defeito D (teste real 2026-09-14): a recusa chegava ao modelo como
  // { erro: 'identity_not_confirmed' } seco e ele improvisava.
  test('a recusa por identidade leva a instrução do que fazer em seguida', async () => {
    findTool.mockReturnValue(toolFake({ exigeIdentidadeForte: true }));
    isToolEnabled.mockResolvedValue(true);
    const r = await executeTool('consultar_plano', { contratoId: 17402 }, { ...CONTEXTO, identidade: { nivel: 'fraca' } });
    expect(r.instrucao).toBe('Identidade ainda não confirmada. Pergunte a data de nascimento e chame confirmar_nascimento; depois chame esta ferramenta de novo. Não peça o CPF de novo.');
    // O nome da ferramenta continua na auditoria, separado da instrução.
    expect(r.detalhe).toBe('consultar_plano');
  });

  test('as outras recusas não ganham instrução (detalhe delas é texto interno)', async () => {
    findTool.mockReturnValue(null);
    const r = await executeTool('consultar_ip', {}, CONTEXTO);
    expect(r.instrucao).toBeUndefined();
  });

  test('exigeIdentidadeForte não se aplica quando não há identidade no contexto (modo assistente)', async () => {
    findTool.mockReturnValue(toolFake({ exigeIdentidadeForte: true }));
    isToolEnabled.mockResolvedValue(true);
    expect((await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO)).ok).toBe(true);
  });

  // I1 (fix round 1): a marcação era inerte sem contexto.identidade — mas um
  // perfil fixo (ferramentasPermitidas) É a triagem, mesmo antes de qualquer
  // identidade ter sido resolvida (ex.: o primeiro turno, antes de
  // buscar_cliente rodar). A regra tem que valer ali também.
  test('exigeIdentidadeForte também vale no perfil fixo mesmo sem contexto.identidade', async () => {
    const tool = toolFake({ exigeIdentidadeForte: true });
    findTool.mockReturnValue(tool);
    const ctx = { ...CONTEXTO, ferramentasPermitidas: ['consultar_plano'] };
    const resultado = await executeTool('consultar_plano', { contratoId: 17402 }, ctx);
    expect(resultado.motivo).toBe('identity_not_confirmed');
    expect(tool.executar).not.toHaveBeenCalled();
  });
});

describe('tool-executor — orçamento de tempo declarado pela ferramenta', () => {
  beforeEach(() => jest.clearAllMocks());

  const lento = () => new Promise((resolve) => setTimeout(() => resolve({ plano: '600MB' }), 60));

  test('tool.timeoutMs vence o orçamento padrão passado ao executor', async () => {
    isToolEnabled.mockResolvedValue(true);
    findTool.mockReturnValue(toolFake({ timeoutMs: 5000, executar: jest.fn(lento) }));
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO, { timeoutMs: 20 });
    expect(result.ok).toBe(true);
  });

  test('uma ferramenta com orçamento curto declarado ainda estoura', async () => {
    isToolEnabled.mockResolvedValue(true);
    findTool.mockReturnValue(toolFake({ timeoutMs: 20, executar: jest.fn(lento) }));
    const result = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO, { timeoutMs: 5000 });
    expect(result.motivo).toBe('timeout');
  });
});
