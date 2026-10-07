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
jest.mock('./trust-unlock.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
const { isToolEnabled } = require('./ai-config.repository');
const { findTool } = require('./tool-registry');
const sgpClient = require('../integrations/sgp-client');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const conversationRepo = require('../conversations/conversation.repository');
const contactRepo = require('../conversations/contact.repository');
const { executeTool } = require('./tool-executor');

// Regra financeira 0/1/2+ (25/09/2026): as ferramentas de cobrança leem os títulos do contrato
// (listAllInvoices) ANTES da 2ª via. Sem títulos vencidos = o fluxo de sempre, que é o que estes
// testes exercitam. Quem testa a regra em si é regra-financeira.test.js.
beforeEach(() => {
  sgpClient.listAllInvoices.mockResolvedValue({ faturas: [], total: 0, completo: true, motivo: null });
});

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
    expect(r.instrucao).toBe('Ainda não sei quem é o cliente. Peça o CPF ou CNPJ e chame buscar_cliente; depois chame esta ferramenta de novo.');
    // O nome da ferramenta continua na auditoria, separado da instrução.
    expect(r.detalhe).toBe('consultar_plano');
  });

  // Documento pendente (25/09/2026): com o CPF já pedido e ainda não informado, a recusa mandava
  // "Peça o CPF ou CNPJ" de novo — o modelo repetia o pedido a cada tentativa de consulta. A ação
  // continua bloqueada; só a instrução deixa de mandar repetir.
  test('13. documento já pedido: a ação continua bloqueada e a recusa não manda pedir de novo', async () => {
    const tool = toolFake({ exigeIdentidadeForte: true });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const documento = { alvo: 'principal', mudancaRelevante: false, irritado: false };
    const r = await executeTool('consultar_plano', { contratoId: 17402 }, { ...CONTEXTO, identidade: { nivel: 'none' }, documento });
    expect(r.motivo).toBe('identity_not_confirmed');
    expect(tool.executar).not.toHaveBeenCalled();
    expect(r.instrucao).toBe('Ainda não sei quem é o cliente, e o CPF ou CNPJ JÁ foi pedido: NÃO peça de novo agora. Responda ao que ele disse sem consultar nada; esta ferramenta só funciona depois de buscar_cliente com o documento.');
  });

  // F1, terceira revisão (30/09/2026): com o esclarecimento da cadeia disponível, a recusa não pode
  // mandar pedir (seria ordem em todo atendimento) nem proibir (desmentiria a permissão) — deixa a
  // decisão ao modelo. A ação continua bloqueada.
  test('13b. documento já pedido e esclarecimento disponível: ação bloqueada, sem ordem de pedir e sem proibir o esclarecimento', async () => {
    const tool = toolFake({ exigeIdentidadeForte: true });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);
    const documento = { alvo: 'principal', mudancaRelevante: false, irritado: false, pedidosNaCadeia: 1, esclarecimentoUsado: false, esclarecimentoDisponivel: true };
    const r = await executeTool('consultar_plano', { contratoId: 17402 }, { ...CONTEXTO, identidade: { nivel: 'none' }, documento });
    expect(r.motivo).toBe('identity_not_confirmed');
    expect(tool.executar).not.toHaveBeenCalled();
    expect(r.instrucao).not.toMatch(/NÃO peça de novo/);
    expect(r.instrucao).not.toMatch(/Peça o CPF/);
    expect(r.instrucao).toMatch(/esclarecer uma vez/);
    expect(r.instrucao).toMatch(/só funciona depois de buscar_cliente com o documento/);
  });

  test('13c. esclarecimento já usado: volta a recusa que não manda pedir de novo', async () => {
    findTool.mockReturnValue(toolFake({ exigeIdentidadeForte: true }));
    isToolEnabled.mockResolvedValue(true);
    const documento = { alvo: 'principal', mudancaRelevante: false, irritado: false, pedidosNaCadeia: 2, esclarecimentoUsado: true, esclarecimentoDisponivel: false };
    const r = await executeTool('consultar_plano', { contratoId: 17402 }, { ...CONTEXTO, identidade: { nivel: 'none' }, documento });
    expect(r.instrucao).toMatch(/NÃO peça de novo agora/);
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

  test('a recusa por identidade não confirmada nunca manda pedir data de nascimento', async () => {
    findTool.mockReturnValue(toolFake({ nome: 'enviar_boleto', exigeIdentidadeForte: true }));
    isToolEnabled.mockResolvedValue(true);
    const contexto = {
      ferramentasPermitidas: ['enviar_boleto'],
      identidade: { nivel: 'none' },
      contracts: [{ id: 1 }],
      contact: {},
    };
    const r = await executeTool('enviar_boleto', { contratoId: 1 }, contexto);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('identity_not_confirmed');
    expect(r.instrucao).not.toMatch(/nascimento/i);
    expect(r.instrucao).not.toMatch(/confirmar_nascimento/);
    expect(r.instrucao).toMatch(/CPF ou CNPJ/);
  });
});

describe('tool-executor — contrato de terceiro (lista de permissão)', () => {
  // Usa o tool-registry de verdade (não o mock do topo do arquivo), como o
  // teste de regressão de buscar_cliente já faz acima: o que está sob teste
  // aqui é exatamente a combinação real de chaveProprietario/
  // exigeIdentidadeForte de cada ferramenta, não uma cópia à mão delas — uma
  // fake reimplementaria esse conhecimento e não pegaria uma divergência
  // futura entre o registro e este teste.
  const registroReal = jest.requireActual('./tool-registry');

  beforeEach(() => {
    jest.clearAllMocks();
    findTool.mockImplementation((nomeConsultado) => registroReal.findTool(nomeConsultado));
  });

  const ARGS_MINIMOS = {
    consultar_faturas: { contratoId: 77 },
    enviar_boleto: { contratoId: 77 },
    gerar_pix: { contratoId: 77 },
    gerar_segunda_via: { contratoId: 77 },
    consultar_plano: { contratoId: 77 },
    consultar_status_conexao: { contratoId: 77 },
    consultar_status_contrato: { contratoId: 77 },
    consultar_financeiro: { contratoId: 77 },
    desbloqueio_confianca: { contratoId: 77 },
  };

  const PERMITIDAS = ['consultar_faturas', 'enviar_boleto', 'gerar_pix', 'gerar_segunda_via'];
  const BLOQUEADAS = [
    'consultar_plano', 'consultar_status_conexao', 'consultar_status_contrato',
    'consultar_financeiro', 'desbloqueio_confianca',
  ];

  function contextoComTerceiro(ferramentas, identidade = { nivel: 'forte', primeiroNome: 'João' }) {
    return {
      ferramentasPermitidas: ferramentas, conversationId: 'c1', contact: { id: 'ct1' },
      contracts: [{ id: 1 }],
      terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
      identidade, sgpCache: {}, registroFerramentas: [],
    };
  }

  // Guarda do próprio teste: se os args pararem de ser válidos, o teste passa a
  // medir invalid_args em vez de autorização, e ninguém percebe.
  test.each([...PERMITIDAS, ...BLOQUEADAS])('os args de teste de %s chegam na checagem de autorização', async (nome) => {
    const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome]));
    expect(r.motivo).not.toBe('invalid_args');
  });

  test.each(PERMITIDAS)('%s é autorizada no contrato de terceiro', async (nome) => {
    const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome]));
    expect(r.motivo).not.toBe('third_party_tool_not_allowed');
    expect(r.motivo).not.toBe('contract_not_owned');
    expect(r.motivo).not.toBe('identity_not_confirmed');
  });

  test.each(BLOQUEADAS)('%s é recusada no contrato de terceiro', async (nome) => {
    const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome]));
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('third_party_tool_not_allowed');
    expect(r.instrucao).toMatch(/outra pessoa/i);
  });

  // Quem pede o boleto da esposa pode não ser cliente nenhum. Três das quatro
  // ferramentas da allowlist exigem identidade forte; sem esta exceção, o fluxo
  // inteiro morria em identity_not_confirmed para quem estava com nível 'none'.
  const SEM_IDENTIDADE = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };

  test.each(PERMITIDAS)('%s funciona no contrato de terceiro mesmo com quem fala não identificado', async (nome) => {
    const contexto = contextoComTerceiro([nome], SEM_IDENTIDADE);
    const r = await executeTool(nome, ARGS_MINIMOS[nome], contexto);
    expect(r.motivo).not.toBe('identity_not_confirmed');
    expect(contexto.identidade.nivel).toBe('none'); // e continua não identificado
  });

  // A exceção vale SÓ no escopo de terceiro. Nos contratos próprios, quem não
  // está identificado continua barrado — mas isso só é observável nas
  // ferramentas que já exigiam identidade forte antes desta tarefa (Fato 1 do
  // brief: 3 das 4 da allowlist, não consultar_faturas). Calculado do
  // registro de verdade, não copiado à mão, para nunca divergir dele: se
  // consultar_faturas um dia ganhar exigeIdentidadeForte, este teste passa a
  // cobri-la sozinho.
  const COM_IDENTIDADE_FORTE = PERMITIDAS.filter((nome) => registroReal.findTool(nome).exigeIdentidadeForte === true);

  test.each(COM_IDENTIDADE_FORTE)('%s continua exigindo identidade forte nos contratos próprios', async (nome) => {
    const contexto = contextoComTerceiro([nome], SEM_IDENTIDADE);
    const r = await executeTool(nome, { contratoId: 1 }, contexto);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('identity_not_confirmed');
  });

  // E nunca escapa para uma ferramenta fora da allowlist, nem no escopo.
  test.each(BLOQUEADAS)('%s não ganha a exceção de identidade pelo escopo de terceiro', async (nome) => {
    const r = await executeTool(nome, ARGS_MINIMOS[nome], contextoComTerceiro([nome], SEM_IDENTIDADE));
    expect(r.motivo).toBe('third_party_tool_not_allowed');
  });

  // À noite desbloqueio_confianca entra na lista da triagem. Continua barrada no
  // contrato alheio: é ação de serviço, não consulta.
  test('desbloqueio_confianca é recusada no contrato de terceiro também à noite', async () => {
    const contexto = contextoComTerceiro(['desbloqueio_confianca']);
    contexto.triagem = { noturno: { ativo: true, retornoAs: '08:00' } };
    const r = await executeTool('desbloqueio_confianca', { contratoId: 77 }, contexto);
    expect(r.motivo).toBe('third_party_tool_not_allowed');
  });

  test('contrato que não é de ninguém continua dando contract_not_owned', async () => {
    const r = await executeTool('enviar_boleto', { contratoId: 999 }, contextoComTerceiro(['enviar_boleto']));
    expect(r.motivo).toBe('contract_not_owned');
  });

  // O quadrante da expiração: o escopo já foi limpo (30 minutos, conclusão,
  // encerramento), mas o modelo ainda carrega o id do contrato do terceiro na
  // memória da conversa e tenta usar. Sem escopo, não há autorização nenhuma —
  // nem a da lista de permissão. Usa as PERMITIDAS de propósito: são elas que
  // passariam se o escopo existisse, então são elas que provam que a ausência
  // do escopo fecha a porta (as BLOQUEADAS já são recusadas por dois motivos
  // diferentes, e o teste ficaria menos específico).
  test.each(PERMITIDAS)('%s no contrato do terceiro SEM escopo registrado volta a contract_not_owned', async (nome) => {
    const contexto = contextoComTerceiro([nome], SEM_IDENTIDADE);
    contexto.terceiro = null;
    const r = await executeTool(nome, ARGS_MINIMOS[nome], contexto);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('contract_not_owned');
  });

  test('sem escopo de terceiro, nada muda para os contratos próprios', async () => {
    const contexto = contextoComTerceiro(['consultar_plano']);
    contexto.terceiro = null;
    const r = await executeTool('consultar_plano', { contratoId: 1 }, contexto);
    expect(r.motivo).not.toBe('third_party_tool_not_allowed');
  });
});

describe('tool-executor — minimização do retorno no contrato de terceiro', () => {
  beforeEach(() => jest.clearAllMocks());

  // FERRAMENTAS_PERMITIDAS_EM_TERCEIRO e a projeção de minimização casam pelo
  // NOME passado a executeTool, não por nenhuma propriedade do objeto da
  // ferramenta — então um fake com o nome certo já basta para testar a
  // aplicação da Task 8, sem depender do SGP de verdade (isso já é coberto,
  // com os nomes reais de campo, em third-party-minimize.test.js).
  const CONTEXTO_TERCEIRO = {
    conversationId: 'c-1', contact: { id: 'ct-1' },
    contracts: [{ id: 1 }],
    terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
  };

  const BRUTO = {
    // Regra 0/1/2+ (25/09/2026): a data exposta é a ORIGINAL; a atualizada (hoje, na vencida) não sai.
    faturas: [{ faturaId: 5, vencimentoOriginal: '2026-09-10', vencimentoAtualizado: '2026-09-25', status: 'aberta', valorOriginal: 135, pagador: 'MARIA SILVA' }],
  };

  test('resultado de ferramenta permitida no contrato do terceiro chega minimizado ao modelo', async () => {
    const tool = toolFake({ nome: 'consultar_faturas', executar: jest.fn().mockResolvedValue(BRUTO) });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);

    const r = await executeTool('consultar_faturas', { contratoId: 77 }, CONTEXTO_TERCEIRO);

    expect(r).toEqual({ ok: true, resultado: { faturas: [{ id: 5, vencimento: '2026-09-10', status: 'aberta' }] } });
    // O bruto (pagador, valor) nunca sobrevive na resposta final.
    expect(JSON.stringify(r)).not.toMatch(/MARIA SILVA|135/);
  });

  test('resultado no contrato do próprio contato nunca passa pela minimização', async () => {
    const tool = toolFake({ nome: 'consultar_faturas', executar: jest.fn().mockResolvedValue(BRUTO) });
    findTool.mockReturnValue(tool);
    isToolEnabled.mockResolvedValue(true);

    const r = await executeTool('consultar_faturas', { contratoId: 1 }, CONTEXTO_TERCEIRO); // 1 é próprio, não 77

    expect(r).toEqual({ ok: true, resultado: BRUTO });
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

describe('tool-executor — contratoId dedutível com um contrato só (Task 10)', () => {
  // Usa o tool-registry de verdade: o que está sob teste é o validar/
  // chaveProprietario reais de consultar_status_conexao e enviar_boleto, não
  // um toolFake() genérico (que sempre finge ser consultar_plano).
  const registroReal = jest.requireActual('./tool-registry');

  beforeEach(() => {
    jest.clearAllMocks();
    findTool.mockImplementation((nomeConsultado) => registroReal.findTool(nomeConsultado));
  });

  test('contratoId ausente com um contrato só é preenchido pelo sistema', async () => {
    const contexto = {
      ferramentasPermitidas: ['consultar_status_conexao'], contracts: [{ id: 42 }], contact: {},
      identidade: { nivel: 'forte' }, conversationId: 'c1',
    };
    await executeTool('consultar_status_conexao', {}, contexto);
    expect(sgpClient.checkConnection).toHaveBeenCalledWith(42);
  });

  // A checagem é estrita (undefined/null) de propósito: um valor que o modelo
  // mandou nunca pode ser sobrescrito por um id deduzido, nem quando é falsy.
  // Se alguém trocar por `!args.contratoId` num refactor de limpeza, este teste
  // fica vermelho — que é o ponto.
  test.each([0, '', false, NaN])('contratoId falsy (%p) não é substituído pelo contrato único: recusa em vez de deduzir', async (valor) => {
    const contexto = {
      ferramentasPermitidas: ['consultar_status_conexao'], contracts: [{ id: 42 }], contact: {},
      identidade: { nivel: 'forte' }, conversationId: 'c1',
    };
    const r = await executeTool('consultar_status_conexao', { contratoId: valor }, contexto);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('invalid_args');
    expect(sgpClient.checkConnection).not.toHaveBeenCalledWith(42);
  });

  test('contratoId ausente com vários contratos continua sendo erro de argumento', async () => {
    const contexto = {
      ferramentasPermitidas: ['consultar_status_conexao'], contracts: [{ id: 1 }, { id: 2 }], contact: {},
      identidade: { nivel: 'forte' }, conversationId: 'c1',
    };
    const r = await executeTool('consultar_status_conexao', {}, contexto);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('invalid_args');
  });

  // REGRA MUDADA (caso Fulana/Beltrana, 25/09/2026). Antes: "o preenchimento nunca alcança um
  // contrato de terceiro". Era esse o furo: com pedido de terceiro em andamento, "manda o pix"
  // sem contrato caía no contrato único de QUEM FALA. Agora a dedução segue o alvo financeiro:
  // com pedido de terceiro, o contrato único DO TERCEIRO (nas ferramentas permitidas em
  // terceiro) e nunca o de quem fala; com dois ou mais do terceiro, nada é deduzido.
  test('com pedido de terceiro, contratoId ausente é preenchido com o contrato único DO TERCEIRO', async () => {
    const contexto = {
      ferramentasPermitidas: ['enviar_boleto'], contracts: [], contact: {},
      terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
      identidade: { nivel: 'forte' }, conversationId: 'c1',
    };
    await executeTool('enviar_boleto', {}, contexto);
    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith(77);
  });

  test('com pedido de terceiro, contratoId ausente NUNCA é preenchido com o contrato único de quem fala', async () => {
    const contexto = {
      ferramentasPermitidas: ['enviar_boleto', 'consultar_status_conexao'], contracts: [{ id: 1 }], contact: {},
      terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
      identidade: { nivel: 'forte' }, conversationId: 'c1',
    };
    await executeTool('enviar_boleto', {}, contexto);
    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith(77);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(1);
    // Ferramenta fora da lista de terceiro: nada é deduzido (nem o do terceiro, nem o de quem fala).
    const r = await executeTool('consultar_status_conexao', {}, contexto);
    expect(r.motivo).toBe('invalid_args');
    expect(sgpClient.checkConnection).not.toHaveBeenCalled();
  });

  test('com pedido de terceiro de dois contratos, contratoId ausente não é deduzido', async () => {
    const contexto = {
      ferramentasPermitidas: ['enviar_boleto'], contracts: [{ id: 1 }], contact: {},
      terceiro: { nome: 'Maria', contratos: [{ id: 77 }, { id: 78 }] },
      identidade: { nivel: 'forte' }, conversationId: 'c1',
    };
    const r = await executeTool('enviar_boleto', {}, contexto);
    expect(r.motivo).toBe('invalid_args');
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalled();
  });
});

// Contencao de 2026-09-22. Caso real: no perfil assistente, runAiTurn executou
// desbloqueio_confianca e o SGP liberou o acesso da cliente por 3 dias ANTES de
// a atendente ver qualquer coisa. Nenhuma aprovacao humana no caminho.
describe('tool-executor — acao no perfil assistente exige aprovacao humana', () => {
  const ASSISTENTE = { ...CONTEXTO, perfil: 'assistente' };

  function ferramenta(nome, categoria, executar = jest.fn()) {
    return {
      nome,
      categoria,
      isentoDeProprietario: true,
      validar: () => ({ ok: true, args: {} }),
      executar,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    isToolEnabled.mockResolvedValue(true);
  });

  test('ACAO_SENSIVEL nao executa e devolve pedido de acao humana', async () => {
    const executar = jest.fn();
    findTool.mockReturnValue(ferramenta('desbloqueio_confianca', 'ACAO_SENSIVEL', executar));

    const r = await executeTool('desbloqueio_confianca', { contratoId: 1 }, ASSISTENTE);

    expect(executar).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('action_requires_human_approval');
    expect(r.instrucao).toBeTruthy();
  });

  test('a instrucao proibe afirmar que a acao aconteceu', async () => {
    findTool.mockReturnValue(ferramenta('desbloqueio_confianca', 'ACAO_SENSIVEL'));

    const r = await executeTool('desbloqueio_confianca', {}, ASSISTENTE);

    expect(r.instrucao).toMatch(/NÃO diga que|nao diga que/i);
    expect(r.instrucao).toMatch(/atendente/i);
  });

  test('ACAO tambem e bloqueada — nao so a sensivel', async () => {
    for (const nome of ['encerrar_atendimento', 'transferir_atendimento', 'esquecer_identificacao', 'definir_motivo_atendimento', 'concluir_triagem']) {
      const executar = jest.fn();
      findTool.mockReturnValue(ferramenta(nome, 'ACAO', executar));

      const r = await executeTool(nome, {}, ASSISTENTE);

      expect(executar).not.toHaveBeenCalled();
      expect(r.motivo).toBe('action_requires_human_approval');
    }
  });

  test('CONSULTA continua executando normalmente', async () => {
    const executar = jest.fn().mockResolvedValue({ plano: 'X' });
    findTool.mockReturnValue(ferramenta('consultar_plano', 'CONSULTA', executar));

    const r = await executeTool('consultar_plano', {}, ASSISTENTE);

    expect(executar).toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.resultado).toEqual({ plano: 'X' });
  });

  // Requisito 7: a protecao vem da CLASSIFICACAO, nao de uma lista de nomes.
  // Uma ferramenta inventada agora, que nunca existiu no projeto, tem de cair
  // na mesma trava.
  test('ferramenta NOVA classificada como acao cai na protecao sozinha', async () => {
    const executar = jest.fn();
    findTool.mockReturnValue(ferramenta('cancelar_contrato_inventada', 'ACAO_SENSIVEL', executar));

    const r = await executeTool('cancelar_contrato_inventada', {}, ASSISTENTE);

    expect(executar).not.toHaveBeenCalled();
    expect(r.motivo).toBe('action_requires_human_approval');
  });

  test('categoria desconhecida ou ausente tambem bloqueia: falha fechada', async () => {
    for (const categoria of ['CATEGORIA_QUE_NAO_EXISTE', undefined, null, '']) {
      const executar = jest.fn();
      findTool.mockReturnValue(ferramenta('ferramenta_sem_categoria', categoria, executar));

      const r = await executeTool('ferramenta_sem_categoria', {}, ASSISTENTE);

      expect(executar).not.toHaveBeenCalled();
      expect(r.motivo).toBe('action_requires_human_approval');
    }
  });

  test('o bloqueio acontece ANTES de qualquer efeito: nem a validacao de posse roda', async () => {
    const executar = jest.fn();
    const tool = ferramenta('desbloqueio_confianca', 'ACAO_SENSIVEL', executar);
    delete tool.isentoDeProprietario;
    tool.chaveProprietario = 'contratoId';
    findTool.mockReturnValue(tool);

    const r = await executeTool('desbloqueio_confianca', { contratoId: 999 }, ASSISTENTE);

    // Sem a trava, isto voltaria contract_not_owned — o que tambem recusaria,
    // mas por outro motivo e depois de passar pelo gate errado.
    expect(r.motivo).toBe('action_requires_human_approval');
    expect(executar).not.toHaveBeenCalled();
  });
});

describe('tool-executor — a triagem NAO muda', () => {
  function ferramenta(nome, categoria, executar = jest.fn()) {
    return { nome, categoria, isentoDeProprietario: true, validar: () => ({ ok: true, args: {} }), executar };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    isToolEnabled.mockResolvedValue(true);
  });

  test('perfil triagem executa acao normalmente', async () => {
    const executar = jest.fn().mockResolvedValue({ concluido: true });
    findTool.mockReturnValue(ferramenta('concluir_triagem', 'ACAO', executar));
    const ctx = { ...CONTEXTO, perfil: 'triagem', ferramentasPermitidas: ['concluir_triagem'] };

    const r = await executeTool('concluir_triagem', {}, ctx);

    expect(executar).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  test('acao sensivel na triagem continua executando', async () => {
    const executar = jest.fn().mockResolvedValue({ liberado: true });
    findTool.mockReturnValue(ferramenta('desbloqueio_confianca', 'ACAO_SENSIVEL', executar));
    const ctx = { ...CONTEXTO, perfil: 'triagem', ferramentasPermitidas: ['desbloqueio_confianca'] };

    const r = await executeTool('desbloqueio_confianca', {}, ctx);

    expect(executar).toHaveBeenCalled();
    expect(r.resultado).toEqual({ liberado: true });
  });

  // Contexto sem perfil (harness de simulacao, chamadas antigas) segue o
  // comportamento de antes: o gate so atua onde o perfil diz "assistente".
  test('contexto sem perfil declarado nao e afetado', async () => {
    const executar = jest.fn().mockResolvedValue({ ok: 1 });
    findTool.mockReturnValue(ferramenta('transferir_atendimento', 'ACAO', executar));

    const r = await executeTool('transferir_atendimento', {}, { ...CONTEXTO, ferramentasPermitidas: ['transferir_atendimento'] });

    expect(executar).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
});

// Contenção de 2026-09-22, prova de EFEITO. Os testes acima usam ferramenta
// falsa e provam que `executar` não roda. Este usa a ferramenta REAL do
// registro, com um contrato REALMENTE suspenso — o estado em que ela liberaria
// —, e prova o que importa para a cliente: o SGP não é consultado nem
// escrito, e nenhuma liberação é gravada em ai_trust_unlocks.
describe('tool-executor — desbloqueio_confianca real não toca o SGP no assistente', () => {
  const registryReal = jest.requireActual('./tool-registry');
  // statusCode 4 = suspenso: sem isso a ferramenta pararia sozinha na guarda
  // de status e o teste passaria sem provar nada sobre o gate.
  const SUSPENSO = { id: 19631, statusCode: 4, status: 'Suspenso', plan: '600 Mega' };

  beforeEach(() => {
    jest.clearAllMocks();
    isToolEnabled.mockResolvedValue(true);
    findTool.mockReturnValue(registryReal.findTool('desbloqueio_confianca'));
    sgpClient.listInvoices.mockResolvedValue([]);
    listTrustUnlocksByContract.mockResolvedValue([]);
  });

  test('não consulta o SGP e não grava liberação', async () => {
    const contexto = {
      perfil: 'assistente',
      conversationId: 'c-1',
      contact: { id: 'ct-1', sgpDocument: '52998224725' },
      contracts: [SUSPENSO],
      sgpCache: {},
      identidade: { nivel: 'forte', origem: 'cpf', primeiroNome: 'Cliente' },
    };

    const r = await executeTool('desbloqueio_confianca', { contratoId: 19631 }, contexto);

    expect(sgpClient.listInvoices).not.toHaveBeenCalled();
    expect(recordTrustUnlock).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('action_requires_human_approval');
  });

  // Contraprova: a MESMA ferramenta, o MESMO contrato suspenso, mudando só o
  // perfil. Sem ela, o teste acima passaria mesmo se a ferramenta estivesse
  // parando por qualquer outro motivo (contrato não elegível, guarda de
  // status, mock faltando) e não pelo gate.
  test('contraprova: na triagem a mesma chamada CHEGA ao SGP', async () => {
    const contexto = {
      perfil: 'triagem',
      conversationId: 'c-1',
      contact: { id: 'ct-1', sgpDocument: '52998224725' },
      contracts: [SUSPENSO],
      sgpCache: {},
      ferramentasPermitidas: ['desbloqueio_confianca'],
      identidade: { nivel: 'forte', origem: 'cpf', primeiroNome: 'Cliente' },
    };

    const r = await executeTool('desbloqueio_confianca', { contratoId: 19631 }, contexto);

    // O que importa aqui é que a execução PASSOU do gate e foi até o SGP. O
    // desfecho depois disso depende de mocks que este teste não monta de
    // propósito — ele não é sobre a regra de elegibilidade.
    expect(sgpClient.listInvoices).toHaveBeenCalledWith(19631);
    expect(r.motivo).not.toBe('action_requires_human_approval');
  });
});

// Requisitos 2, 3, 4 e 5 do dono, provados pelo EFEITO e com as ferramentas
// REAIS do registro: o que importa não é a ferramenta devolver `ok:false`, é
// a conversa não fechar, o setor não mudar e o vínculo do contato não sumir.
describe('tool-executor — ações reais não produzem efeito no assistente', () => {
  const registryReal = jest.requireActual('./tool-registry');
  const ASSISTENTE = {
    perfil: 'assistente',
    conversationId: 'c-1',
    contact: { id: 'ct-1', sgpClientId: 9, sgpContractId: 17402, sgpDocument: '52998224725' },
    contracts: [{ id: 17402 }],
    sgpCache: {},
    identidade: { nivel: 'forte', origem: 'cpf', primeiroNome: 'Cliente' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    isToolEnabled.mockResolvedValue(true);
    conversationRepo.getConversationWithContact.mockResolvedValue({ id: 'c-1', status: 'waiting', sectorId: 's-1' });
    conversationRepo.listSectors = undefined;
  });

  test('encerrar_atendimento: a conversa NÃO é fechada', async () => {
    findTool.mockReturnValue(registryReal.findTool('encerrar_atendimento'));

    const r = await executeTool('encerrar_atendimento', { resumo: 'resolvido' }, ASSISTENTE);

    expect(conversationRepo.closeConversationByAi).not.toHaveBeenCalled();
    expect(r.motivo).toBe('action_requires_human_approval');
  });

  test('transferir_atendimento: o setor NÃO muda', async () => {
    findTool.mockReturnValue(registryReal.findTool('transferir_atendimento'));

    const r = await executeTool('transferir_atendimento', { setorId: 's-2', resumo: 'x' }, ASSISTENTE);

    expect(conversationRepo.setConversationSector).not.toHaveBeenCalled();
    expect(r.motivo).toBe('action_requires_human_approval');
  });

  test('esquecer_identificacao: o vínculo do contato NÃO é apagado', async () => {
    findTool.mockReturnValue(registryReal.findTool('esquecer_identificacao'));

    const r = await executeTool('esquecer_identificacao', {}, ASSISTENTE);

    expect(contactRepo.setContactSgpLink).not.toHaveBeenCalled();
    expect(conversationRepo.markPhoneContested).not.toHaveBeenCalled();
    expect(r.motivo).toBe('action_requires_human_approval');
  });

  // Requisito 5 com ferramenta real: o gate não pode ter emparedado a consulta
  // junto — é ela que faz a sugestão valer alguma coisa para a atendente.
  test('consultar_plano (CONSULTA) continua executando e devolvendo o dado', async () => {
    findTool.mockReturnValue(registryReal.findTool('consultar_plano'));
    const contexto = {
      ...ASSISTENTE,
      contracts: [{ id: 17402, statusCode: 1, status: 'Ativo', plan: '600 Mega', internetPlan: '600 Mbps', login: 'cli17402' }],
    };

    const r = await executeTool('consultar_plano', { contratoId: 17402 }, contexto);

    expect(r.ok).toBe(true);
    expect(r.resultado).toEqual({ plano: '600 Mega', velocidade: '600 Mbps', loginPPPoE: 'cli17402' });
  });
});

// C4 v2 (04/10/2026, avaliação real de 04/10): erro ou tempo esgotado em concluir_triagem chegavam ao modelo como
// { erro: 'execution_error' } ou { erro: 'timeout' }, sem instrução, e o modelo passou a prender a transferência ao
// CPF. A definição real da ferramenta entra aqui; só o executar é trocado, para falhar ou travar.
describe('tool-executor — concluir_triagem sem confirmação (erro ou tempo esgotado)', () => {
  const real = jest.requireActual('./tool-registry');
  const CONTEXTO_TRIAGEM = {
    conversationId: 'c-1', contact: { id: 'ct-1', sgpDocument: null }, contracts: [],
    identidade: { nivel: 'none', origem: 'none' }, ferramentasPermitidas: ['concluir_triagem', 'consultar_plano'],
  };
  const ARGS = {
    setorId: '11111111-1111-1111-1111-111111111111', motivoId: null, resumo: 'Pediu atendente.', confianca: 0.9,
    pendenciasObrigatorias: ['CPF'], clientePediuAtendente: true,
  };
  const concluirCom = (executar) => findTool.mockReturnValue({ ...real.findTool('concluir_triagem'), executar });

  beforeEach(() => jest.clearAllMocks());

  const exigeOsElementos = (r) => {
    expect(r.instrucao).toMatch(/NÃO teve confirmação/);
    expect(r.instrucao).toMatch(/não tem relação com CPF nem com nenhum dado do cliente/);
    expect(r.instrucao).toMatch(/CPF não é requisito para pedir atendimento humano/);
    expect(r.instrucao).toMatch(/Não diga que encaminhou, que ele entrou na fila, que um atendente já está com ele, que alguém vai continuar ou retornar, nem que você vai tentar de novo depois/);
    expect(r.instrucao).toMatch(/não diga que nada foi feito ou registrado: o resultado não é conhecido/);
  };

  test('erro: a recusa traz a instrução, e o detalhe interno fica só na auditoria', async () => {
    concluirCom(jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432')));
    const r = await executeTool('concluir_triagem', ARGS, CONTEXTO_TRIAGEM);
    expect(r).toMatchObject({ ok: false, motivo: 'execution_error', detalhe: 'connect ECONNREFUSED 10.0.0.5:5432' });
    // Conclusão do atendimento (04/10/2026): a recusa sem confirmação vai marcada — o turno seguinte sabe da tentativa.
    expect(r.semConfirmacao).toBe(true);
    exigeOsElementos(r);
    expect(r.instrucao).toMatch(/Ele já pediu para falar com um atendente: reconheça esse pedido e não pergunte de novo se ele quer/);
    expect(r.instrucao).not.toMatch(/ECONNREFUSED/);
  });

  test('tempo esgotado: a mesma instrução', async () => {
    concluirCom(() => new Promise(() => {}));
    const r = await executeTool('concluir_triagem', ARGS, CONTEXTO_TRIAGEM, { timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, motivo: 'timeout' });
    expect(r.semConfirmacao).toBe(true);
    exigeOsElementos(r);
  }, 10000);

  test('sem a declaração do pedido: a instrução não afirma que ele pediu atendente', async () => {
    concluirCom(jest.fn().mockRejectedValue(new Error('banco fora')));
    const { clientePediuAtendente, ...semDeclaracao } = ARGS;
    const r = await executeTool('concluir_triagem', { ...semDeclaracao, pendenciasObrigatorias: [] }, CONTEXTO_TRIAGEM);
    exigeOsElementos(r);
    expect(r.instrucao).toMatch(/Se ele já pediu atendente, não pergunte de novo se ele quer/);
    expect(r.instrucao).not.toMatch(/Ele já pediu para falar com um atendente/);
  });

  test('outra ferramenta com erro ou tempo esgotado continua sem instrução (nada muda fora da conclusão)', async () => {
    // O registro de verdade responde por nome (concluir_triagem inclusive): só o executar de consultar_plano é trocado.
    let executar = jest.fn().mockRejectedValue(new Error('SGP down'));
    findTool.mockImplementation((n) => (n === 'consultar_plano' ? { ...real.findTool('consultar_plano'), executar } : real.findTool(n)));
    isToolEnabled.mockResolvedValue(true);
    const erro = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO);
    expect(erro).toMatchObject({ motivo: 'execution_error', detalhe: 'SGP down' });
    expect(erro.instrucao).toBeUndefined();
    expect(erro.semConfirmacao).toBeUndefined();
    executar = () => new Promise(() => {});
    const lento = await executeTool('consultar_plano', { contratoId: 17402 }, CONTEXTO, { timeoutMs: 20 });
    expect(lento.motivo).toBe('timeout');
    expect(lento.instrucao).toBeUndefined();
  }, 10000);

  test('recusa devolvida pela própria ferramenta ({ ok: false }) não ganha a instrução: não é falha sem confirmação', async () => {
    concluirCom(jest.fn().mockResolvedValue({ ok: false, erro: 'Unknown setorId' }));
    const r = await executeTool('concluir_triagem', ARGS, CONTEXTO_TRIAGEM);
    expect(r).toMatchObject({ ok: false, motivo: 'execution_error', detalhe: 'Unknown setorId' });
    expect(r.instrucao).toBeUndefined();
    expect(r.semConfirmacao).toBeUndefined();
  });
});

// Pendências do atendimento (04/10/2026; avaliação real r2 E12 #4 e r3 E6 #4): o modelo inventou um documento para
// buscar_cliente com quem fala já identificado. O documento só vale com ORIGEM — escrito pelo cliente nesta conversa, ou o
// do titular já confirmado. Formato e dígito verificador não provam origem.
describe('tool-executor — buscar_cliente na triagem: o documento precisa de origem', () => {
  const real = jest.requireActual('./tool-registry');
  const TRIAGEM_IDENTIFICADA = {
    conversationId: 'c-1', contact: { id: 'ct-1', sgpDocument: '52998224725' }, contracts: [{ id: 17402 }],
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'Fulano', client: { id: 9, document: '52998224725' }, contestado: false },
    ferramentasPermitidas: ['buscar_cliente'],
    falasDoCliente: ['Oi, vocês aceitam pagamento por PIX?'],
  };
  const SEM_IDENTIDADE = { contact: { id: 'ct-1', sgpDocument: null }, identidade: { nivel: 'none', origem: 'none' }, contracts: [] };
  const buscar = () => {
    const executar = jest.fn().mockResolvedValue({ cliente: { nome: 'X' } });
    findTool.mockImplementation((n) => (n === 'buscar_cliente' ? { ...real.findTool('buscar_cliente'), executar } : real.findTool(n)));
    isToolEnabled.mockResolvedValue(true);
    return executar;
  };
  beforeEach(() => jest.clearAllMocks());

  test('CPF que o cliente não escreveu (inventado), com quem fala identificado: nada é consultado, e o modelo lê que ele já está identificado', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '00000000000' }, TRIAGEM_IDENTIFICADA);
    expect(r).toMatchObject({ ok: false, motivo: 'document_without_origin' });
    expect(r.instrucao).toMatch(/NADA foi consultado/);
    expect(r.instrucao).toMatch(/JÁ está identificado: não peça CPF ou CNPJ dele/);
    expect(executar).not.toHaveBeenCalled();
  });

  test('formato e dígito verificador válidos não provam origem', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '111.444.777-35' }, TRIAGEM_IDENTIFICADA);
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test('CPF de outra pessoa que o cliente escreveu (com pontuação) segue como consulta de terceiro', async () => {
    const executar = buscar();
    const ctx = { ...TRIAGEM_IDENTIFICADA, falasDoCliente: ['quero pagar a fatura da minha mãe', 'o cpf dela é 111.444.777-35'] };
    expect((await executeTool('buscar_cliente', { cpf: '11144477735' }, ctx)).ok).toBe(true);
    expect(executar).toHaveBeenCalledWith(expect.objectContaining({ cpf: '11144477735', titularEOutraPessoa: true }), expect.anything());
  });

  test('o documento do titular já confirmado tem origem (o cadastro)', async () => {
    const executar = buscar();
    expect((await executeTool('buscar_cliente', { cpf: '529.982.247-25' }, TRIAGEM_IDENTIFICADA)).ok).toBe(true);
    expect(executar).toHaveBeenCalled();
  });

  test('sem identificação: CPF inventado não é consultado, e o modelo lê que deve pedir o documento', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '11144477735' }, { ...TRIAGEM_IDENTIFICADA, ...SEM_IDENTIDADE, falasDoCliente: ['quero minha fatura'] });
    expect(r.motivo).toBe('document_without_origin');
    expect(r.instrucao).toMatch(/peça o CPF ou CNPJ do titular/);
    expect(executar).not.toHaveBeenCalled();
  });

  test('sem identificação: o CPF que ele escreveu é consultado', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '11144477735' }, { ...TRIAGEM_IDENTIFICADA, ...SEM_IDENTIDADE, falasDoCliente: ['meu cpf é 11144477735'] });
    expect(r.ok).toBe(true);
    expect(executar).toHaveBeenCalled();
  });

  test('texto no lugar do CPF ("contato já identificado"): recusa com a instrução de que ele já está identificado', async () => {
    buscar();
    const r = await executeTool('buscar_cliente', { cpf: 'contato já identificado' }, TRIAGEM_IDENTIFICADA);
    expect(r).toMatchObject({ ok: false, motivo: 'invalid_args' });
    expect(r.instrucao).toMatch(/JÁ está identificado/);
  });

  // Revisão (04/10/2026, 4 e 5): igualdade com um número de 11 ou 14 dígitos que o cliente escreveu — nunca pedaço de número;
  // vale o ditado por extenso (áudio transcrito, "meia") e o partido em duas falas seguidas.
  test('pedaço de número que o cliente escreveu (o número do contrato) não é documento', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '17402' }, { ...TRIAGEM_IDENTIFICADA, falasDoCliente: ['é o contrato 17402'] });
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test('CPF ditado por extenso (áudio transcrito, com "meia") tem origem', async () => {
    buscar();
    // Fechamento limitado (04/10/2026): um CPF com dígito verificador válido (o dígito verificador passou a ser necessário).
    const ctx = { ...TRIAGEM_IDENTIFICADA, ...SEM_IDENTIDADE, falasDoCliente: ['meu cpf é cinco cinco cinco meia meia meia sete sete sete dois zero'] };
    expect((await executeTool('buscar_cliente', { cpf: '55566677720' }, ctx)).ok).toBe(true);
  });

  // Revisão do incremento (04/10/2026): formatos reais de áudio e digitação não podem ser recusados como "não escrito".
  test.each([
    ['vírgulas de pausa no áudio', 'meu cpf é 529, 982, 247-25'],
    ['dígito a dígito com vírgulas', '5, 2, 9, 9, 8, 2, 2, 4, 7, 2, 5'],
    ['traço com espaços', '529.982.247 - 25'],
    ['artigo depois do número', '52998224725 um abraço'],
  ])('CPF escrito com %s tem origem', async (_nome, fala) => {
    buscar();
    const ctx = { ...TRIAGEM_IDENTIFICADA, ...SEM_IDENTIDADE, falasDoCliente: [fala] };
    expect((await executeTool('buscar_cliente', { cpf: '52998224725' }, ctx)).ok).toBe(true);
  });

  test('número ditado logo depois do CPF não estraga o CPF escrito (vale também o texto como ele veio)', async () => {
    buscar();
    const ctx = { ...TRIAGEM_IDENTIFICADA, ...SEM_IDENTIDADE, falasDoCliente: ['meu cpf é 52998224725 um dois'] };
    expect((await executeTool('buscar_cliente', { cpf: '52998224725' }, ctx)).ok).toBe(true);
  });

  test('o "uma" de artigo não soma dígito na junção de duas falas', async () => {
    buscar();
    const ctx = { ...TRIAGEM_IDENTIFICADA, ...SEM_IDENTIDADE, falasDoCliente: ['tenho uma dúvida, meu cpf é 529.982.247', '25'] };
    expect((await executeTool('buscar_cliente', { cpf: '52998224725' }, ctx)).ok).toBe(true);
  });

  test('11 dígitos tirados de um número maior (linha digitável colada) não são documento', async () => {
    const executar = buscar();
    const ctx = { ...TRIAGEM_IDENTIFICADA, falasDoCliente: ['segue a linha: 23790.12345 60000.123456 78901.234567 1 98760000012345'] };
    const r = await executeTool('buscar_cliente', { cpf: '23790123456' }, ctx);
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test('CPF partido em duas falas seguidas tem origem', async () => {
    buscar();
    const ctx = { ...TRIAGEM_IDENTIFICADA, ...SEM_IDENTIDADE, falasDoCliente: ['meu cpf é 111.444', '777-35'] };
    expect((await executeTool('buscar_cliente', { cpf: '11144477735' }, ctx)).ok).toBe(true);
  });

  test('sem as falas do cliente no contexto (chamada fora do orquestrador), nada muda', async () => {
    const executar = buscar();
    const { falasDoCliente, ...semFalas } = TRIAGEM_IDENTIFICADA;
    expect((await executeTool('buscar_cliente', { cpf: '11144477735' }, semFalas)).ok).toBe(true);
    expect(executar).toHaveBeenCalled();
  });

  // Rodada 8 (N1): com dúvida financeira no turno — gravada no escopo ou do próprio turno — ou depois de ele voltar à própria
  // cobrança, o documento de OUTRA pessoa só vale se ele o mandou de novo, numa fala nova deste turno (falasNovasDoCliente).
  // O que só existe no histórico não é consultado: nada é gravado, e a dúvida (ou a volta ao titular) fica.
  describe('com dúvida financeira: o documento só do histórico não esclarece', () => {
    const HISTORICO = ['manda o boleto da minha vizinha, o cpf dela é 111.444.777-35', 'agora manda o boleto da rua do João'];
    const LOCALIZADA = { nome: 'Fulana', contratos: [{ id: 401 }] };
    const base = (extra) => ({ ...TRIAGEM_IDENTIFICADA, falasDoCliente: HISTORICO, falasNovasDoCliente: ['agora manda o boleto da rua do João'], ...extra });
    // Revisão da rodada 8 (achado 1): a instrução segue a mesma divisão da guarda do documento — só a dúvida que pede documento
    // manda pedi-lo de novo; a fraca pergunta de quem é, a de endereço pergunta o endereço; nenhuma das duas pede documento.
    test.each([
      ['a dúvida forte gravada no escopo', { terceiro: { ...LOCALIZADA, alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: 'terceiro_nao_vinculado' }, /mande de novo, nesta conversa, o CPF ou CNPJ do titular da conta/],
      ['a dúvida fraca gravada no escopo', { terceiro: { ...LOCALIZADA, alvoPendente: 'proprio_nao_afirmado' }, alvoAmbiguo: 'proprio_nao_afirmado' }, /se a cobrança é dele ou da pessoa já citada; não peça documento/],
      ['a dúvida só do turno', { terceiro: LOCALIZADA, alvoAmbiguo: 'referencia_incompleta' }, /se a cobrança é dele ou da pessoa já citada; não peça documento/],
      ['a dúvida de endereço gravada', { terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'endereco_desconhecido' }, alvoAmbiguo: 'endereco_desconhecido' }, /de qual endereço dele é a conta.*não peça documento/],
    ])('%s: nada é consultado, e a instrução segue o tipo da dúvida', async (_, extra, instrucao) => {
      const executar = buscar();
      const r = await executeTool('buscar_cliente', { cpf: '11144477735', titularEOutraPessoa: true }, base(extra));
      expect(r).toMatchObject({ ok: false, motivo: 'document_before_doubt' });
      expect(r.instrucao).toMatch(/NADA foi consultado/);
      expect(r.instrucao).toMatch(instrucao);
      if (!/mande de novo/.test(String(instrucao))) expect(r.instrucao).not.toMatch(/mande de novo/);
      // Revisão da rodada 8 (achado 3): a recusa não afirma que o número "já estava na conversa" (pode só não ter vindo depois da dúvida).
      expect(r.instrucao).not.toMatch(/já estava na conversa/);
      expect(r.instrucao).not.toMatch(/\bdela\b/);
      expect(executar).not.toHaveBeenCalled();
    });
    test('a dúvida gravada no escopo vale mesmo que o turno não a repita (alvoAmbiguo vazio)', async () => {
      const executar = buscar();
      const r = await executeTool('buscar_cliente', { cpf: '11144477735', titularEOutraPessoa: true }, base({ terceiro: { ...LOCALIZADA, alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: false }));
      expect(r).toMatchObject({ ok: false, motivo: 'document_before_doubt' });
      expect(executar).not.toHaveBeenCalled();
    });
    test('depois de ele voltar à própria cobrança neste turno: o documento dela do histórico não é consultado', async () => {
      const executar = buscar();
      const r = await executeTool('buscar_cliente', { cpf: '11144477735' }, base({ terceiro: null, alvoAmbiguo: false, alvoVoltouAoTitular: true, falasNovasDoCliente: ['agora a minha fatura da Rua de Teste'] }));
      expect(r).toMatchObject({ ok: false, motivo: 'document_before_doubt' });
      expect(r.instrucao).toMatch(/a cobrança é dele/);
      expect(executar).not.toHaveBeenCalled();
    });
    // A origem efetiva: o documento numa fala a partir da que originou a dúvida (o pedido de terceiro com o CPF na mesma
    // mensagem) vale; o de antes dela, não.
    const JANELA = [
      { id: 'm-1', de: 'cliente', texto: 'manda o boleto da minha vizinha, o cpf dela é 111.444.777-35' },
      { id: 'm-2', de: 'ia', texto: 'Prontinho!' },
      { id: 'm-3', de: 'cliente', texto: 'agora manda o boleto da rua do João' },
    ];
    test.each([['m-1', true], ['m-3', false], ['m-inexistente', false]])('dúvida gravada desde a entrada %s: o documento da m-1 vale = %s', async (desde, vale) => {
      const executar = buscar();
      const ctx = base({ mensagensDaJanela: JANELA, terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento', duvidaDesde: desde }, alvoAmbiguo: 'outra_pessoa_sem_documento', falasNovasDoCliente: ['pode ser o boleto'] });
      const r = await executeTool('buscar_cliente', { cpf: '11144477735', titularEOutraPessoa: true }, ctx);
      expect(r.ok !== false).toBe(vale);
      expect(executar).toHaveBeenCalledTimes(vale ? 1 : 0);
    });

    // Revisão da rodada 8 (achado 2): no MESMO lote, o CPF que veio antes da fala que criou a dúvida não a tira — a origem é a
    // entrada que deixou a dúvida (duvidaDesde ou, para a dúvida só do turno, origemDoAlvoNoTurno), não o começo do lote.
    const LOTE = [
      { id: 'm-1', de: 'cliente', texto: 'manda o boleto da minha vizinha, o cpf dela é 111.444.777-35' },
      { id: 'm-2', de: 'ia', texto: 'Prontinho!' },
      { id: 'm-3', de: 'cliente', texto: 'manda o boleto dela, o cpf é 111.444.777-35' },
      { id: 'm-4', de: 'cliente', texto: 'não, espera, é o da rua do João' },
    ];
    test.each([
      ['dúvida gravada neste lote, originada na m-4', { terceiro: { ...LOCALIZADA, alvoPendente: 'terceiro_nao_vinculado', duvidaDesde: 'm-4' }, alvoAmbiguo: 'terceiro_nao_vinculado' }],
      ['dúvida só do turno, originada na m-4', { terceiro: LOCALIZADA, alvoAmbiguo: 'referencia_incompleta', origemDoAlvoNoTurno: 'm-4' }],
    ])('%s: o CPF da m-3 (no lote, antes da dúvida) não é consultado', async (_, extra) => {
      const executar = buscar();
      const ctx = base({ mensagensDaJanela: LOTE, falasNovasDoCliente: [LOTE[2].texto, LOTE[3].texto], ...extra });
      expect(await executeTool('buscar_cliente', { cpf: '11144477735', titularEOutraPessoa: true }, ctx)).toMatchObject({ motivo: 'document_before_doubt' });
      expect(executar).not.toHaveBeenCalled();
    });
    test('volta ao titular originada na m-4: o CPF da m-3 (antes dela, no lote) não é consultado', async () => {
      const executar = buscar();
      const ctx = base({ terceiro: null, alvoAmbiguo: false, alvoVoltouAoTitular: true, origemDoAlvoNoTurno: 'm-4', mensagensDaJanela: [...LOTE.slice(0, 3), { id: 'm-4', de: 'cliente', texto: 'agora a minha fatura da Rua de Teste' }], falasNovasDoCliente: [LOTE[2].texto, 'agora a minha fatura da Rua de Teste'] });
      expect(await executeTool('buscar_cliente', { cpf: '11144477735' }, ctx)).toMatchObject({ motivo: 'document_before_doubt' });
      expect(executar).not.toHaveBeenCalled();
    });

    // Revisão da rodada 8 (achado 3): sem a origem da dúvida na janela (escopo de antes desta versão, dúvida vencida, ou origem
    // antiga), as falas novas são lidas pela janela EM ORDEM, com a mensagem da IA que pediu o documento logo antes — o CPF
    // mandado partido ("111.444" e "777-35") em resposta ao pedido marcado vale, como em qualquer outra consulta.
    test.each([
      ['dúvida vencida (sem origem)', { terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'terceiro_expirado' }, alvoAmbiguo: 'terceiro_expirado' }],
      ['dúvida com a origem fora da janela', { terceiro: { ...LOCALIZADA, alvoPendente: 'terceiro_nao_vinculado', duvidaDesde: 'm-antiga' }, alvoAmbiguo: 'terceiro_nao_vinculado' }],
    ])('%s: o CPF partido em duas falas novas, em resposta ao pedido marcado, é consultado', async (_, extra) => {
      const executar = buscar();
      const janela = [
        { id: 'm-1', de: 'cliente', texto: 'agora manda o boleto da rua do João' },
        { id: 'o-1', de: 'ia', texto: 'Para eu localizar, me passe o CPF dele.', pediuDocumento: true },
        { id: 'm-2', de: 'cliente', texto: '111.444' },
        { id: 'm-3', de: 'cliente', texto: '777-35' },
      ];
      const ctx = base({ ...extra, falasDoCliente: ['agora manda o boleto da rua do João', '111.444', '777-35'], mensagensDaJanela: janela, falasNovasDoCliente: ['111.444', '777-35'], idsDasFalasNovas: ['m-2', 'm-3'] });
      expect((await executeTool('buscar_cliente', { cpf: '11144477735', titularEOutraPessoa: true }, ctx)).ok).toBe(true);
      expect(executar).toHaveBeenCalled();
    });
    // Revisão da rodada 8 (achado 4): quem fala ainda não identificado — o CPF reconsultado pode ser o dele. A recusa fica (o
    // código não tem como separar o dele do de outra pessoa), e a instrução não fala "dela".
    test('quem fala não identificado: o CPF do histórico continua recusado, sem dizer que é "dela"', async () => {
      const executar = buscar();
      const ctx = base({ ...SEM_IDENTIDADE, terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' }, alvoAmbiguo: 'outra_pessoa_sem_documento', falasDoCliente: ['meu cpf é 529.982.247-25, minha internet caiu', 'e manda o boleto da minha mãe'], falasNovasDoCliente: ['vê a minha internet primeiro'] });
      const r = await executeTool('buscar_cliente', { cpf: '52998224725' }, ctx);
      expect(r).toMatchObject({ ok: false, motivo: 'document_before_doubt' });
      expect(r.instrucao).not.toMatch(/\bdela\b/);
      expect(executar).not.toHaveBeenCalled();
    });

    test('o mesmo documento mandado de novo numa fala nova deste turno: as regras de sempre (consulta)', async () => {
      const executar = buscar();
      const ctx = base({ terceiro: { ...LOCALIZADA, alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: 'terceiro_nao_vinculado', falasNovasDoCliente: ['o cpf dela é 111.444.777-35'] });
      expect((await executeTool('buscar_cliente', { cpf: '11144477735', titularEOutraPessoa: true }, ctx)).ok).toBe(true);
      expect(executar).toHaveBeenCalled();
    });
    test.each([
      ['sem dúvida e sem volta ao titular', { terceiro: LOCALIZADA, alvoAmbiguo: false }],
      ['dúvida técnica (escopo não lido)', { terceiro: null, alvoAmbiguo: 'escopo_nao_lido' }],
      ['sem a lista das falas novas (outro chamador)', { terceiro: { ...LOCALIZADA, alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: 'terceiro_nao_vinculado', falasNovasDoCliente: undefined }],
    ])('%s: a consulta do documento do histórico segue como antes', async (_, extra) => {
      const executar = buscar();
      expect((await executeTool('buscar_cliente', { cpf: '11144477735', titularEOutraPessoa: true }, base(extra))).ok).toBe(true);
      expect(executar).toHaveBeenCalled();
    });
    test('o documento de quem fala, com a dúvida: não é esta regra que decide (segue o caminho de sempre)', async () => {
      const executar = buscar();
      const ctx = base({ terceiro: { ...LOCALIZADA, alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: 'terceiro_nao_vinculado' });
      expect((await executeTool('buscar_cliente', { cpf: '52998224725' }, ctx)).ok).toBe(true);
      expect(executar).toHaveBeenCalled();
    });
  });
});

// Fechamento limitado (04/10/2026; não impeditivo B4 da conferência das pendências): números incidentais — telefone,
// contrato, dia, valor — somados entre si davam um documento "com origem". Igualdade numérica sozinha não prova origem: o
// número tem de ter sido apresentado como documento (a palavra cpf/cnpj/documento na fala, a IA pedindo o documento na
// fala anterior a ela, o formato de documento, ou a fala ser só o número). Sem origem, nada é consultado nem gravado.
describe('tool-executor — buscar_cliente: número incidental não é origem de documento', () => {
  const real = jest.requireActual('./tool-registry');
  const IDENTIFICADO = {
    conversationId: 'c-1', contact: { id: 'ct-1', sgpDocument: '52998224725' }, contracts: [{ id: 17402 }],
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'Fulano', client: { id: 9, document: '52998224725' }, contestado: false },
    ferramentasPermitidas: ['buscar_cliente'],
  };
  const SEM_IDENTIDADE = { contact: { id: 'ct-1', sgpDocument: null }, identidade: { nivel: 'none', origem: 'none' }, contracts: [] };
  const buscar = () => {
    const executar = jest.fn().mockResolvedValue({ cliente: { nome: 'X' } });
    findTool.mockImplementation((n) => (n === 'buscar_cliente' ? { ...real.findTool('buscar_cliente'), executar } : real.findTool(n)));
    isToolEnabled.mockResolvedValue(true);
    return executar;
  };
  // A janela como o orquestrador monta: em ordem, quem falou e o texto (e a marca do pedido de documento da IA).
  const comJanela = (base, itens) => ({
    ...base,
    mensagensDaJanela: itens.map(([de, texto, extra], i) => ({ id: 'm-' + (i + 1), de, texto, ...(extra || {}) })),
    falasDoCliente: itens.filter(([de]) => de === 'cliente').map(([, texto]) => texto),
  });
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['telefone e outro número na mesma fala', [['cliente', 'meu telefone é 98888-7777, casa 12']], '98888777712'],
    ['telefone numa fala e um número na seguinte', [['cliente', 'meu telefone é 98888-7777'], ['cliente', '12']], '98888777712'],
    ['contrato, dia e valor na mesma fala', [['cliente', 'contrato 17402, dia 10, valor 99,90']], '17402109990'],
    ['CPF completo numa fala e um número na seguinte (formaria um CNPJ)', [['cliente', 'meu cpf é 529.982.247-25'], ['cliente', '123']], '52998224725123'],
    ['número de 11 dígitos entre outras palavras, sem ser apresentado como documento', [['cliente', 'meu telefone é 98988887777']], '98988887777'],
  ])('reprodução — %s: nada é consultado e a identidade confirmada fica como estava', async (_nome, itens, documento) => {
    const executar = buscar();
    const ctx = comJanela(IDENTIFICADO, itens);
    const antes = JSON.stringify({ contact: ctx.contact, identidade: ctx.identidade, contracts: ctx.contracts });
    const r = await executeTool('buscar_cliente', { cpf: documento }, ctx);
    expect(r).toMatchObject({ ok: false, motivo: 'document_without_origin' });
    expect(r.instrucao).toMatch(/JÁ está identificado: não peça CPF ou CNPJ dele/);
    expect(executar).not.toHaveBeenCalled();
    expect(JSON.stringify({ contact: ctx.contact, identidade: ctx.identidade, contracts: ctx.contracts })).toBe(antes);
  });

  test('sem a janela em ordem (só as falas), as concatenações também não valem', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '98888777712' }, { ...IDENTIFICADO, falasDoCliente: ['meu telefone é 98888-7777', '12'] });
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test.each([
    ['a IA pediu o CPF e ele respondeu com o número e uma saudação', [['ia', 'Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.'], ['cliente', '52998224725 um abraço']], '52998224725'],
    ['a IA pediu o CPF e ele ditou com pausas, sem dizer "cpf"', [['ia', 'Qual o CPF do titular?'], ['cliente', '529, 982, 247-25']], '52998224725'],
    ['a IA pediu (marca do pedido de documento) e ele mandou o número com um agradecimento', [['ia', 'Pode me passar os números do titular?', { pediuDocumento: true }], ['cliente', '52998224725 obrigado']], '52998224725'],
    ['a IA pediu o CPF (com a marca do pedido) e ele partiu o número em duas falas', [['ia', 'Me informe o CPF do titular, por favor.', { pediuDocumento: true }], ['cliente', '529.982'], ['cliente', '247-25']], '52998224725'],
    ['"cpf" na fala, com pausas e outro número depois (áudio)', [['cliente', 'meu cpf é 529, 982, 247-25, quero o boleto do dia 10']], '52998224725'],
    ['a fala é só o número', [['cliente', '52998224725']], '52998224725'],
    ['CNPJ partido em duas falas, com "cnpj"', [['cliente', 'o cnpj é 11.222.333/0001'], ['cliente', '81']], '11222333000181'],
    ['ditado por extenso depois de a IA pedir o CPF', [['ia', 'Qual é o seu CPF?'], ['cliente', 'cinco dois nove nove oito dois dois quatro sete dois cinco']], '52998224725'],
  ])('preservado — %s: tem origem', async (_nome, itens, documento) => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: documento }, comJanela({ ...IDENTIFICADO, ...SEM_IDENTIDADE }, itens));
    expect(r.ok).toBe(true);
    expect(executar).toHaveBeenCalled();
  });

  test('preservado — CPF de outra pessoa no formato de documento, no meio do pedido: consulta de terceiro', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '11144477735' }, comJanela(IDENTIFICADO, [['cliente', 'manda o boleto da minha mãe 111.444.777-35']]));
    expect(r.ok).toBe(true);
    expect(executar).toHaveBeenCalledWith(expect.objectContaining({ cpf: '11144477735', titularEOutraPessoa: true }), expect.anything());
  });

  test('o pedido de documento da IA vale para as falas depois dele, não para uma fala anterior', async () => {
    const executar = buscar();
    // 98888777717 tem dígito verificador válido: só o contexto decide.
    const r = await executeTool('buscar_cliente', { cpf: '98888777717' }, comJanela(IDENTIFICADO, [
      ['cliente', 'meu telefone é 98888-7777'], ['cliente', '17'], ['ia', 'Me informe o CPF do titular, por favor.', { pediuDocumento: true }], ['cliente', 'é o da minha mãe'],
    ]));
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test('a recusa diz ao modelo que número de telefone, contrato ou valor não é documento, e manda pedir o de outra pessoa', async () => {
    buscar();
    const r = await executeTool('buscar_cliente', { cpf: '98988887777' }, comJanela(IDENTIFICADO, [['cliente', 'meu telefone é 98988887777']]));
    expect(r.instrucao).toMatch(/telefone, contrato, dia ou valor não são documento/);
    expect(r.instrucao).toMatch(/peça o CPF ou CNPJ dessa pessoa/);
  });

  test('o pedido de documento vale até a próxima fala da IA: depois dela, um número incidental não tem origem', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '98888777717' }, comJanela(IDENTIFICADO, [
      ['ia', 'Qual o CPF do titular?', { pediuDocumento: true }], ['cliente', '52998224725'], ['ia', 'Encontrei seu cadastro. Posso ajudar em algo mais?'],
      ['cliente', 'meu telefone novo é 98888-7777'], ['cliente', '17'],
    ]));
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  // Revisão do delta (04/10/2026): o dígito verificador é condição necessária; o número escrito de uma vez vale em qualquer
  // fala; o montado de pedaços só com contexto — e o contexto não reabre os incidentais.
  test.each([
    ['saudação e o número', 'Bom dia 52998224725'],
    ['pedido e o número', 'segunda via boleto 52998224725'],
    ['contestação do cadastro', 'esse cadastro não é meu, é 52998224725'],
  ])('preservado — CPF escrito de uma vez, sem "cpf" e sem pedido (%s): tem origem', async (_nome, fala) => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '52998224725' }, comJanela({ ...IDENTIFICADO, ...SEM_IDENTIDADE }, [['cliente', fala]]));
    expect(r.ok).toBe(true);
    expect(executar).toHaveBeenCalled();
  });

  test('preservado — CPF de outra pessoa sem formato, no meio do pedido: consulta de terceiro', async () => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '11144477735' }, comJanela(IDENTIFICADO, [['cliente', 'manda o boleto da minha mãe 11144477735']]));
    expect(r.ok).toBe(true);
    expect(executar).toHaveBeenCalledWith(expect.objectContaining({ cpf: '11144477735', titularEOutraPessoa: true }), expect.anything());
  });

  test.each([
    ['telefone e um número depois de a IA pedir o CPF', [['ia', 'Me informe o CPF do titular.', { pediuDocumento: true }], ['cliente', 'meu telefone é 98888-7777'], ['cliente', '12']], '98888777712'],
    ['contrato e outro número depois do pedido', [['ia', 'Me informe o CPF do titular.', { pediuDocumento: true }], ['cliente', 'o contrato é 17402'], ['cliente', '109990']], '17402109990'],
    ['telefone com a palavra cpf na fala', [['cliente', 'não tenho o cpf aqui, meu número é 98988887777']], '98988887777'],
    ['CPF e um número com a palavra cpf (formaria um CNPJ)', [['cliente', 'meu cpf 52998224725, 123']], '52998224725123'],
  ])('reprodução com contexto — %s: dígito verificador inválido, nada é consultado', async (_nome, itens, documento) => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: documento }, comJanela(IDENTIFICADO, itens));
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test.each([
    ['a fala da IA só cita o CPF, sem a marca de pedido', [['ia', 'Localizei seu cadastro pelo CPF.'], ['cliente', 'meu telefone é 98888-7777'], ['cliente', '17']]],
    ['o marcador do sistema "[cliente enviou um documento]" não é palavra do cliente', [['cliente', '[cliente enviou um documento] 98888-7777'], ['cliente', '17']]],
  ])('sem contexto de verdade — %s: a junção, mesmo com dígito verificador válido, não vale', async (_nome, itens) => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: '98888777717' }, comJanela(IDENTIFICADO, itens));
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test.each([
    ['telefone e outro número na mesma fala, sem contexto', [['cliente', 'meu telefone é 98888-7777, 17']], '98888777717'],
    ['CPF completo e três dígitos na fala seguinte (formariam um CNPJ válido)', [['cliente', 'meu cpf é 529.982.247-25'], ['cliente', '027']], '52998224725027'],
  ])('dígito verificador válido por acaso — %s: nada é consultado', async (_nome, itens, documento) => {
    const executar = buscar();
    const r = await executeTool('buscar_cliente', { cpf: documento }, comJanela(IDENTIFICADO, itens));
    expect(r.motivo).toBe('document_without_origin');
    expect(executar).not.toHaveBeenCalled();
  });

  test('a junção com a marca de pedido de documento da IA vale (é o contexto que a regra exige)', async () => {
    buscar();
    const r = await executeTool('buscar_cliente', { cpf: '52998224725' }, comJanela({ ...IDENTIFICADO, ...SEM_IDENTIDADE }, [
      ['ia', 'Pode me passar o documento do titular?', { pediuDocumento: true }], ['cliente', '529.982.247'], ['cliente', '25'],
    ]));
    expect(r.ok).toBe(true);
  });
});
