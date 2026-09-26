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
