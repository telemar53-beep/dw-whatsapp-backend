jest.mock('../integrations/sgp-client');
jest.mock('../sectors/sector.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('./trust-unlock.repository');

const sgpClient = require('../integrations/sgp-client');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const { listTools, findTool, toOpenAiTools } = require('./tool-registry');
const { listSectors } = require('../sectors/sector.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { setConversationSector, setSuggestedReason } = require('../conversations/conversation.repository');

describe('tool-registry', () => {
  test('registers exactly the known tools, sensitive ones included', () => {
    const nomes = listTools().map((t) => t.nome).sort();
    expect(nomes).toEqual([
      'buscar_cliente', 'consultar_faturas', 'consultar_faturas_todos_contratos', 'consultar_financeiro',
      'consultar_plano', 'consultar_status_conexao', 'consultar_status_contrato',
      'definir_motivo_atendimento', 'desbloqueio_confianca', 'gerar_pix', 'gerar_segunda_via',
      'transferir_atendimento',
    ]);
  });

  test('every tool declares a category the executor understands', () => {
    for (const tool of listTools()) {
      expect(['CONSULTA', 'ACAO', 'ACAO_SENSIVEL']).toContain(tool.categoria);
    }
  });

  test('every tool has a validator and an executor', () => {
    for (const tool of listTools()) {
      expect(typeof tool.validar).toBe('function');
      expect(typeof tool.executar).toBe('function');
      expect(tool.descricao.length).toBeGreaterThan(10);
    }
  });

  // Estas três travam o desenho do executor de ferramentas (tool-executor.js):
  // ele decide a checagem de propriedade lendo estas duas marcações, não mais
  // farejando um "contratoId" fixo. Sem estes testes, um erro de digitação ou
  // uma marcação incorreta aqui vira um jeito legítimo de burlar a checagem lá.
  test('every tool declares exactly one ownership marker: chaveProprietario xor isentoDeProprietario', () => {
    for (const tool of listTools()) {
      const declaraChave = typeof tool.chaveProprietario === 'string';
      const declaraIsencao = tool.isentoDeProprietario === true;
      expect(declaraChave).not.toBe(declaraIsencao);
    }
  });

  test('a declared chaveProprietario names an argument that exists in that tool\'s parametros.properties', () => {
    for (const tool of listTools()) {
      if (typeof tool.chaveProprietario === 'string') {
        expect(tool.parametros.properties).toHaveProperty(tool.chaveProprietario);
      }
    }
  });

  test('the ownership exemption list is exactly these four tools, by name', () => {
    // Adicionar uma isenção exige editar esta lista — a decisão passa por um
    // revisor em vez de escapar dentro da definição de uma ferramenta.
    // consultar_faturas_todos_contratos entrou porque não recebe id nenhum do
    // modelo: percorre contexto.contracts, carregado pelo servidor a partir do
    // CPF do próprio contato — não há valor vindo do modelo para conferir.
    const isentas = listTools().filter((t) => t.isentoDeProprietario === true).map((t) => t.nome).sort();
    expect(isentas).toEqual([
      'buscar_cliente', 'consultar_faturas_todos_contratos', 'definir_motivo_atendimento', 'transferir_atendimento',
    ]);
  });

  test('the sensitive tools are the invoice ones', () => {
    expect(findTool('gerar_segunda_via').categoria).toBe('ACAO_SENSIVEL');
    expect(findTool('gerar_pix').categoria).toBe('ACAO_SENSIVEL');
  });

  test('toOpenAiTools exposes only name, description and parameters', () => {
    const exposto = toOpenAiTools(['consultar_plano']);
    expect(exposto).toHaveLength(1);
    expect(exposto[0]).toEqual({
      type: 'function',
      function: {
        name: 'consultar_plano',
        description: expect.any(String),
        parameters: expect.any(Object),
      },
    });
    // Nada do nosso lado interno pode vazar para o modelo.
    expect(JSON.stringify(exposto)).not.toContain('executar');
    expect(JSON.stringify(exposto)).not.toContain('categoria');
  });

  test('toOpenAiTools omits tools that are not enabled', () => {
    expect(toOpenAiTools([])).toEqual([]);
    expect(toOpenAiTools(['gerar_pix']).map((t) => t.function.name)).toEqual(['gerar_pix']);
  });

  test('validar rejects a contratoId that is not a positive integer', () => {
    const tool = findTool('consultar_status_conexao');
    expect(tool.validar({ contratoId: 17402 }).ok).toBe(true);
    expect(tool.validar({ contratoId: 'abc' }).ok).toBe(false);
    expect(tool.validar({ contratoId: -1 }).ok).toBe(false);
    expect(tool.validar({}).ok).toBe(false);
  });

  test('buscar_cliente validar strips non-digits and rejects an empty document', () => {
    const tool = findTool('buscar_cliente');
    expect(tool.validar({ cpf: '529.982.247-25' })).toEqual({ ok: true, args: { cpf: '52998224725' } });
    expect(tool.validar({ cpf: 'abc' }).ok).toBe(false);
  });

  // Fix 7 (final review): /^[0-9a-f-]{36}$/i accepted 36 hex characters with no
  // hyphens at all — that reaches Postgres and raises a 22P02 cast error instead
  // of a clean refusal. This validator receives input generated by a language
  // model, so a loose shape is not a theoretical concern.
  test('definir_motivo_atendimento validar rejects 36 hex characters with no hyphens', () => {
    const tool = findTool('definir_motivo_atendimento');
    expect(tool.validar({ motivoId: 'a'.repeat(36) }).ok).toBe(false);
    expect(tool.validar({ motivoId: '11111111-1111-1111-1111-111111111111' }).ok).toBe(true);
  });

  test('transferir_atendimento validar rejects 36 hex characters with no hyphens', () => {
    const tool = findTool('transferir_atendimento');
    expect(tool.validar({ setorId: 'a'.repeat(36), resumo: 'resumo' }).ok).toBe(false);
    expect(tool.validar({ setorId: '11111111-1111-1111-1111-111111111111', resumo: 'resumo' }).ok).toBe(true);
  });
});

describe('transferir_atendimento executar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('an unknown setorId returns a failure result and never touches the repository', async () => {
    listSectors.mockResolvedValue([{ id: 'sector-1', name: 'Financeiro', createdAt: new Date() }]);
    const tool = findTool('transferir_atendimento');

    const resultado = await tool.executar(
      { setorId: 'sector-unknown', resumo: 'Cliente relata cobrança indevida.' },
      { conversationId: 'conv-1' }
    );

    expect(resultado.ok).toBe(false);
    expect(setConversationSector).not.toHaveBeenCalled();
  });

  test('a known sector where setConversationSector returns a conversation returns success naming the sector', async () => {
    listSectors.mockResolvedValue([{ id: 'sector-1', name: 'Financeiro', createdAt: new Date() }]);
    setConversationSector.mockResolvedValue({ id: 'conv-1', sectorId: 'sector-1' });
    const tool = findTool('transferir_atendimento');

    const resultado = await tool.executar(
      { setorId: 'sector-1', resumo: 'Cliente relata cobrança indevida.' },
      { conversationId: 'conv-1' }
    );

    expect(resultado).toEqual({ transferido: true, setor: 'Financeiro' });
    expect(setConversationSector).toHaveBeenCalledWith('conv-1', 'sector-1');
  });

  test('a known sector where setConversationSector returns null returns a failure, not {transferido: true}', async () => {
    listSectors.mockResolvedValue([{ id: 'sector-1', name: 'Financeiro', createdAt: new Date() }]);
    setConversationSector.mockResolvedValue(null);
    const tool = findTool('transferir_atendimento');

    const resultado = await tool.executar(
      { setorId: 'sector-1', resumo: 'Cliente relata cobrança indevida.' },
      { conversationId: 'conv-1' }
    );

    expect(resultado.ok).toBe(false);
    expect(resultado).not.toEqual({ transferido: true, setor: 'Financeiro' });
  });
});

describe('definir_motivo_atendimento executar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('an unknown motivoId returns a failure result and never touches the repository', async () => {
    findReasonById.mockResolvedValue(null);
    const tool = findTool('definir_motivo_atendimento');

    const resultado = await tool.executar(
      { motivoId: '11111111-1111-1111-1111-111111111111' },
      { conversationId: 'conv-1' }
    );

    expect(resultado.ok).toBe(false);
    expect(setSuggestedReason).not.toHaveBeenCalled();
  });

  test('an inactive motivoId returns a failure result and never touches the repository', async () => {
    findReasonById.mockResolvedValue({ id: 'reason-1', name: 'Cancelamento', active: false, createdAt: new Date() });
    const tool = findTool('definir_motivo_atendimento');

    const resultado = await tool.executar(
      { motivoId: '11111111-1111-1111-1111-111111111111' },
      { conversationId: 'conv-1' }
    );

    expect(resultado.ok).toBe(false);
    expect(setSuggestedReason).not.toHaveBeenCalled();
  });

  test('an active motivoId where setSuggestedReason returns a conversation returns success naming the reason', async () => {
    findReasonById.mockResolvedValue({ id: 'reason-1', name: 'Cancelamento', active: true, createdAt: new Date() });
    setSuggestedReason.mockResolvedValue({ id: 'conv-1', suggestedReasonId: 'reason-1' });
    const tool = findTool('definir_motivo_atendimento');

    const resultado = await tool.executar(
      { motivoId: '11111111-1111-1111-1111-111111111111' },
      { conversationId: 'conv-1' }
    );

    expect(resultado).toEqual({ registrado: true, motivo: 'Cancelamento' });
    expect(setSuggestedReason).toHaveBeenCalledWith('conv-1', 'reason-1');
  });

  test('an active motivoId where setSuggestedReason returns null returns a failure, not {registrado: true}', async () => {
    findReasonById.mockResolvedValue({ id: 'reason-1', name: 'Cancelamento', active: true, createdAt: new Date() });
    setSuggestedReason.mockResolvedValue(null);
    const tool = findTool('definir_motivo_atendimento');

    const resultado = await tool.executar(
      { motivoId: '11111111-1111-1111-1111-111111111111' },
      { conversationId: 'conv-1' }
    );

    expect(resultado.ok).toBe(false);
    expect(resultado).not.toEqual({ registrado: true, motivo: 'Cancelamento' });
  });
});

describe('consultar_faturas_todos_contratos executar', () => {
  const CONTRATO_A = { id: 1, statusCode: 1, status: 'Ativo', plan: '600MB', address: 'RUA X, 1', login: 'a' };
  const CONTRATO_B = { id: 2, statusCode: 4, status: 'Suspenso', plan: '300MB', address: 'AV Y, 2', login: 'b' };
  const FATURA = { id: 10, status: 'Gerado', statusid: 1, valor: 99.9, vencimento: '2026-09-30', data_pagamento: null, gerapix: true };

  beforeEach(() => jest.clearAllMocks());

  test('sem cliente identificado, responde que precisa de buscar_cliente', async () => {
    const r = await findTool('consultar_faturas_todos_contratos').executar({}, { contracts: [] });
    expect(r.sucesso).toBe(false);
    expect(sgpClient.listInvoices).not.toHaveBeenCalled();
  });

  test('consulta cada contrato do contexto e agrupa por endereço e plano', async () => {
    sgpClient.listInvoices.mockResolvedValue({ faturas: [FATURA] });
    const r = await findTool('consultar_faturas_todos_contratos').executar({}, { contracts: [CONTRATO_A, CONTRATO_B] });
    expect(sgpClient.listInvoices).toHaveBeenCalledTimes(2);
    expect(r.contratos).toHaveLength(2);
    expect(r.contratos[0]).toMatchObject({ contratoId: 1, endereco: 'RUA X, 1', plano: '600MB', status: 'ativo' });
    expect(r.contratos[1]).toMatchObject({ contratoId: 2, endereco: 'AV Y, 2', status: 'suspenso' });
    expect(r.contratos[0].faturas[0]).toMatchObject({ faturaId: 10, valorOriginal: 99.9, vencimentoOriginal: '2026-09-30' });
    expect(JSON.stringify(r)).not.toContain('"login"');
  });

  test('falha do SGP num contrato não esconde os outros', async () => {
    sgpClient.listInvoices.mockImplementation((id) => (id === 2 ? Promise.reject(new Error('SGP fora')) : Promise.resolve({ faturas: [FATURA] })));
    const r = await findTool('consultar_faturas_todos_contratos').executar({}, { contracts: [CONTRATO_A, CONTRATO_B] });
    expect(r.contratos[0].faturas).toHaveLength(1);
    expect(r.contratos[1].faturas).toBeNull();
    expect(r.contratos[1].erro).toMatch(/não foi possível/i);
  });

  test('é isenta da checagem de dono e não tem parâmetros', () => {
    const tool = findTool('consultar_faturas_todos_contratos');
    expect(tool.isentoDeProprietario).toBe(true);
    expect(tool.validar({ contratoId: 999 })).toEqual({ ok: true, args: {} });
  });
});

describe('desbloqueio_confianca executar', () => {
  const SUSPENSO = { id: 26515, statusCode: 4, status: 'Suspenso', plan: '100MB', address: 'RUA Z', paymentPromisesThisMonth: 0 };
  const ATIVO = { id: 17402, statusCode: 1, status: 'Ativo', plan: '600MB', address: 'RUA X', paymentPromisesThisMonth: 0 };
  const FATURA_VENCIDA = { id: 1, status: 'Gerado', statusid: 1, valor: 100, vencimento: '2026-08-30', data_pagamento: null };
  const contexto = (contract) => ({ contracts: [contract], contact: { id: 'ct-1' } });

  beforeEach(() => {
    jest.clearAllMocks();
    listTrustUnlocksByContract.mockResolvedValue([]);
    sgpClient.listInvoices.mockResolvedValue({ faturas: [FATURA_VENCIDA] });
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: true, liberadoDias: 3, protocolo: '9999', motivo: null });
    recordTrustUnlock.mockResolvedValue({ id: 'l-1' });
  });

  test('é ação sensível com dono verificado pelo contratoId', () => {
    const tool = findTool('desbloqueio_confianca');
    expect(tool.categoria).toBe('ACAO_SENSIVEL');
    expect(tool.chaveProprietario).toBe('contratoId');
  });

  test('contrato que não está suspenso não é liberado e o SGP não é chamado', async () => {
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 17402 }, contexto(ATIVO));
    expect(r.liberado).toBe(false);
    expect(r.motivo).toMatch(/não está suspenso/);
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
  });

  test('contador mensal do SGP > 0 bloqueia antes de chamar', async () => {
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto({ ...SUSPENSO, paymentPromisesThisMonth: 1 }));
    expect(r).toEqual({ liberado: false, motivo: expect.stringMatching(/neste mês/) });
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
  });

  test('liberação nossa há menos de 30 dias bloqueia, com os dias restantes', async () => {
    listTrustUnlocksByContract.mockResolvedValue([{ createdAt: new Date(Date.now() - 10 * 86400000) }]);
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto(SUSPENSO));
    expect(r.liberado).toBe(false);
    expect(r.diasRestantes).toBe(20);
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
  });

  test('liberação anterior não paga bloqueia', async () => {
    listTrustUnlocksByContract.mockResolvedValue([{ createdAt: new Date(Date.now() - 45 * 86400000) }]);
    sgpClient.listInvoices.mockResolvedValue({ faturas: [{ ...FATURA_VENCIDA, vencimento: '2026-06-30' }] });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto(SUSPENSO));
    expect(r.motivo).toMatch(/fatura em aberto anterior à última liberação/);
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
  });

  test('elegível: chama o SGP, registra e devolve prazo e protocolo', async () => {
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto(SUSPENSO));
    expect(sgpClient.requestTrustUnlock).toHaveBeenCalledWith(26515);
    expect(recordTrustUnlock).toHaveBeenCalledWith({ contactId: 'ct-1', contractId: 26515, protocolo: '9999', liberadoDias: 3 });
    expect(r).toEqual({ liberado: true, dias: 3, protocolo: '9999' });
  });

  test('recusa do SGP volta como motivo, sem registrar', async () => {
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: false, liberadoDias: null, protocolo: null, motivo: 'Quantidade de títulos atrasados maior que o limite. Recurso não disponível' });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto(SUSPENSO));
    expect(r).toEqual({ liberado: false, motivo: expect.stringMatching(/títulos atrasados/) });
    expect(recordTrustUnlock).not.toHaveBeenCalled();
  });

  test('falha ao registrar não transforma uma liberação feita em "não liberou"', async () => {
    recordTrustUnlock.mockRejectedValue(new Error('db down'));
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto(SUSPENSO));
    expect(r.liberado).toBe(true);
  });
});

describe('desbloqueio_confianca — condições operacionais (revisão)', () => {
  const SUSPENSO = { id: 26515, statusCode: 4, status: 'Suspenso', plan: '100MB', address: 'RUA Z', paymentPromisesThisMonth: 0 };
  const FATURA_VENCIDA = { id: 1, status: 'Gerado', statusid: 1, valor: 100, vencimento: '2026-08-30', data_pagamento: null };
  const contexto = () => ({ contracts: [SUSPENSO], contact: { id: 'ct-1' } });

  beforeEach(() => {
    jest.clearAllMocks();
    listTrustUnlocksByContract.mockResolvedValue([]);
    sgpClient.listInvoices.mockResolvedValue({ faturas: [FATURA_VENCIDA], paginacao: { total: 1 } });
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: true, liberadoDias: 3, protocolo: '9999', motivo: null });
    recordTrustUnlock.mockResolvedValue({ id: 'l-1' });
  });

  test('declara orçamento de tempo maior que o HTTP do SGP', () => {
    expect(findTool('desbloqueio_confianca').timeoutMs).toBeGreaterThan(15000);
  });

  test('contrato ausente do contexto não explode nem chama o SGP', async () => {
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 1 }, { contracts: [], contact: { id: 'ct-1' } });
    expect(r.liberado).toBe(false);
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
  });

  test('timeout na escrita devolve resultado indeterminado, sem registrar e sem afirmar nada', async () => {
    sgpClient.requestTrustUnlock.mockRejectedValue(Object.assign(new Error('Failed to reach SGP'), { cause: { message: 'timeout of 15000ms exceeded' } }));
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto());
    expect(r).toMatchObject({ liberado: null, indeterminado: true });
    expect(r.motivo).toMatch(/não foi possível confirmar/i);
    expect(recordTrustUnlock).not.toHaveBeenCalled();
  });

  test('outro erro na escrita propaga (o executor transforma em execution_error)', async () => {
    sgpClient.requestTrustUnlock.mockRejectedValue(new Error('SGP fora'));
    await expect(findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto())).rejects.toThrow('SGP fora');
  });

  test('segunda tentativa no mesmo turno é recusada sem tocar o SGP', async () => {
    const ctx = contexto();
    const tool = findTool('desbloqueio_confianca');
    await tool.executar({ contratoId: 26515 }, ctx);
    const segunda = await tool.executar({ contratoId: 26515 }, ctx);
    expect(segunda.liberado).toBe(false);
    expect(segunda.motivo).toMatch(/já foi tentada/);
    expect(sgpClient.requestTrustUnlock).toHaveBeenCalledTimes(1);
  });

  test('duas chamadas em paralelo na mesma rodada: só uma chega ao SGP', async () => {
    const ctx = contexto();
    const tool = findTool('desbloqueio_confianca');
    const [a, b] = await Promise.all([tool.executar({ contratoId: 26515 }, ctx), tool.executar({ contratoId: 26515 }, ctx)]);
    expect([a.liberado, b.liberado].filter((v) => v === true)).toHaveLength(1);
    expect(sgpClient.requestTrustUnlock).toHaveBeenCalledTimes(1);
  });

  test('liberado sem prazo devolve prazoDesconhecido em vez de deixar o modelo chutar', async () => {
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: true, liberadoDias: null, protocolo: '1', motivo: null });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto());
    expect(r).toEqual({ liberado: true, dias: null, protocolo: '1', prazoDesconhecido: true });
  });

  test('histórico de faturas truncado que não cobre a janela falha fechado', async () => {
    listTrustUnlocksByContract.mockResolvedValue([{ createdAt: new Date(Date.now() - 45 * 86400000) }]);
    sgpClient.listInvoices.mockResolvedValue({ faturas: [{ ...FATURA_VENCIDA, vencimento: '2026-12-30' }], paginacao: { total: 90 } });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, contexto());
    expect(r.liberado).toBe(false);
    expect(r.motivo).toMatch(/histórico/i);
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
  });
});

describe('consultar_faturas_todos_contratos — lista parcial', () => {
  test('sinaliza quando o SGP paginou e a lista não é completa', async () => {
    const contrato = { id: 1, statusCode: 1, status: 'Ativo', plan: '600MB', address: 'RUA X' };
    sgpClient.listInvoices.mockResolvedValue({ faturas: [{ id: 1, status: 'Gerado', vencimento: '2026-09-30' }], paginacao: { total: 70, limit: 50 } });
    const r = await findTool('consultar_faturas_todos_contratos').executar({}, { contracts: [contrato] });
    expect(r.contratos[0]).toMatchObject({ listaParcial: true, totalFaturas: 70 });
  });

  test('lista completa não carrega a marcação', async () => {
    const contrato = { id: 1, statusCode: 1, status: 'Ativo', plan: '600MB', address: 'RUA X' };
    sgpClient.listInvoices.mockResolvedValue({ faturas: [{ id: 1, status: 'Gerado', vencimento: '2026-09-30' }], paginacao: { total: 1 } });
    const r = await findTool('consultar_faturas_todos_contratos').executar({}, { contracts: [contrato] });
    expect(r.contratos[0].listaParcial).toBeUndefined();
  });
});
