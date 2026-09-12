jest.mock('../integrations/sgp-client');
jest.mock('../sectors/sector.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
jest.mock('./trust-unlock.repository');
jest.mock('../media/media-storage');
jest.mock('../queue/outbound-queue');
jest.mock('../realtime/socket-server');

const sgpClient = require('../integrations/sgp-client');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const { listTools, findTool, toOpenAiTools } = require('./tool-registry');
const { listSectors } = require('../sectors/sector.repository');
const { findReasonById } = require('../reasons/reason.repository');
const {
  setConversationSector, setSuggestedReason, concludeAiTriage, getConversationWithContact,
} = require('../conversations/conversation.repository');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { saveMediaFile } = require('../media/media-storage');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { broadcast, broadcastToDashboard } = require('../realtime/socket-server');

describe('tool-registry', () => {
  test('registers exactly the known tools, sensitive ones included', () => {
    const nomes = listTools().map((t) => t.nome).sort();
    expect(nomes).toEqual([
      'buscar_cliente', 'concluir_triagem', 'confirmar_nascimento', 'consultar_faturas',
      'consultar_faturas_todos_contratos', 'consultar_financeiro',
      'consultar_plano', 'consultar_status_conexao', 'consultar_status_contrato',
      'definir_motivo_atendimento', 'desbloqueio_confianca', 'enviar_boleto', 'esquecer_identificacao',
      'gerar_pix', 'gerar_segunda_via', 'transferir_atendimento',
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
      'buscar_cliente', 'concluir_triagem', 'confirmar_nascimento', 'consultar_faturas_todos_contratos',
      'definir_motivo_atendimento', 'esquecer_identificacao', 'transferir_atendimento',
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

describe('desbloqueio_confianca — data-limite da promessa', () => {
  const SUSPENSO = { id: 26515, statusCode: 4, status: 'Suspenso', plan: '100MB', address: 'RUA Z', paymentPromisesThisMonth: 0 };
  beforeEach(() => {
    jest.clearAllMocks();
    listTrustUnlocksByContract.mockResolvedValue([]);
    sgpClient.listInvoices.mockResolvedValue({ faturas: [], paginacao: { total: 0 } });
    recordTrustUnlock.mockResolvedValue({ id: 'l-1' });
  });

  test('repassa pagarAte ao modelo quando o SGP devolve a data', async () => {
    // Formato observado no teste real de 2026-09-12 no contrato 26515.
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: true, liberadoDias: 3, dataPromessa: '2026-09-15', protocolo: '260912153100', motivo: null });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, { contracts: [SUSPENSO], contact: { id: 'ct-1' } });
    expect(r).toEqual({ liberado: true, dias: 3, protocolo: '260912153100', pagarAte: '2026-09-15' });
  });
});

describe('confirmar_nascimento', () => {
  const ctx = () => ({ identidade: { nivel: 'fraca', origem: 'cpf', dataNascimento: '1990-05-20', nascimentoTentado: false } });
  test('data certa em DD/MM/AAAA eleva para forte', async () => {
    const c = ctx();
    const r = await findTool('confirmar_nascimento').executar({ data: '20/05/1990' }, c);
    expect(r).toEqual({ confirmado: true });
    expect(c.identidade.nivel).toBe('forte');
    expect(c.identidade.origem).toBe('cpf_confirmed');
  });
  test('aceita AAAA-MM-DD e D/M/AA', async () => {
    for (const data of ['1990-05-20', '20/5/90']) {
      const c = ctx();
      expect((await findTool('confirmar_nascimento').executar({ data }, c)).confirmado).toBe(true);
    }
  });
  test('data errada mantém fraca e só permite uma tentativa', async () => {
    const c = ctx();
    expect((await findTool('confirmar_nascimento').executar({ data: '01/01/2000' }, c)).confirmado).toBe(false);
    expect(c.identidade.nivel).toBe('fraca');
    const segunda = await findTool('confirmar_nascimento').executar({ data: '20/05/1990' }, c);
    expect(segunda.confirmado).toBe(false);
    expect(segunda.motivo).toMatch(/já foi feita/);
  });
  test('sem data de nascimento no cadastro, não confirma e explica', async () => {
    const c = { identidade: { nivel: 'fraca', dataNascimento: null, nascimentoTentado: false } };
    expect((await findTool('confirmar_nascimento').executar({ data: '20/05/1990' }, c)).confirmado).toBe(false);
  });
  test('o resultado nunca contém a data cadastrada', async () => {
    const c = ctx();
    const r = await findTool('confirmar_nascimento').executar({ data: '01/01/2000' }, c);
    expect(JSON.stringify(r)).not.toContain('1990');
  });
});

describe('esquecer_identificacao', () => {
  test('zera a identidade do turno e o vínculo do contato', async () => {
    const c = { identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', dataNascimento: 'x' }, contracts: [{ id: 1 }], contact: { id: 'ct-1', sgpDocument: '1' } };
    const r = await findTool('esquecer_identificacao').executar({}, c);
    expect(r).toEqual({ esquecido: true });
    expect(c.identidade).toMatchObject({ nivel: 'none', origem: 'none', primeiroNome: null, contestado: true });
    expect(c.contracts).toEqual([]);
    expect(c.contact.sgpDocument).toBeNull();
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', { sgpClientId: null, sgpContractId: null, sgpDocument: null });
  });
});

describe('buscar_cliente no perfil de triagem', () => {
  beforeEach(() => jest.clearAllMocks());
  test('atualiza a identidade para fraca com primeiro nome e data de nascimento no servidor', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9, name: 'MARIA SOUZA', document: '1' }, contracts: [{ id: 5, login: 'l', plan: 'p', statusCode: 1 }] });
    sgpClient.findClientRecord.mockResolvedValue({ total: 1, cliente: { id: 9, cpfcnpj: '11122233344', dataNascimento: '1985-01-02' } });
    const c = { contact: { id: 'ct-1' }, identidade: { nivel: 'none', origem: 'none' } };
    const r = await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(c.identidade).toMatchObject({ nivel: 'fraca', origem: 'cpf', primeiroNome: 'Maria', dataNascimento: '1985-01-02', nascimentoTentado: false });
    expect(JSON.stringify(r)).not.toContain('1985');
  });
  test('sem identidade no contexto (assistente) não muda nada', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9, name: 'X', document: '1' }, contracts: [] });
    const c = { contact: { id: 'ct-1' } };
    await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(c.identidade).toBeUndefined();
    expect(sgpClient.findClientRecord).not.toHaveBeenCalled();
  });
});

describe('enviar_boleto', () => {
  const ctx = () => ({ conversationId: 'c-1', channelId: 'ch-1', contracts: [{ id: 17402 }], identidade: { nivel: 'forte' } });
  beforeEach(() => {
    jest.clearAllMocks();
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '9', dueDate: '2026-09-20', value: 89.9, boletoLink: 'https://x/b.pdf', pixCode: 'pix' }] });
    sgpClient.downloadBoletoPdf.mockResolvedValue(Buffer.from('%PDF'));
    saveMediaFile.mockResolvedValue('abc.pdf');
    enqueueOutboundMessage.mockResolvedValue({ id: 'm-9' });
  });
  test('baixa o PDF, manda como documento com sentBy ai e marca resolvido', async () => {
    const c = ctx();
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, c);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c-1', channelId: 'ch-1', messageType: 'document', mediaPath: 'abc.pdf',
      mediaMimeType: 'application/pdf', mediaFilename: 'boleto.pdf', sentBy: 'ai',
    }));
    expect(r).toEqual({ enviado: true, valor: 89.9, vencimento: '2026-09-20' });
    expect(c.resolvidoPelaIa).toBe(true);
  });
  test('sem fatura em aberto, não envia nada', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: false, duplicates: [] });
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
    expect(r).toEqual({ enviado: false, motivo: 'Nenhuma fatura em aberto' });
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
  test('declara exigeIdentidadeForte e dono por contratoId', () => {
    const t = findTool('enviar_boleto');
    expect(t.exigeIdentidadeForte).toBe(true);
    expect(t.chaveProprietario).toBe('contratoId');
  });
  test('gerar_pix e gerar_segunda_via também exigem identidade forte', () => {
    expect(findTool('gerar_pix').exigeIdentidadeForte).toBe(true);
    expect(findTool('gerar_segunda_via').exigeIdentidadeForte).toBe(true);
  });
  test('gerar_pix no perfil de triagem marca resolvidoPelaIa', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ value: 1, dueDate: 'd', pixCode: 'p' }] });
    const c = ctx();
    await findTool('gerar_pix').executar({ contratoId: 17402 }, c);
    expect(c.resolvidoPelaIa).toBe(true);
  });
});

describe('concluir_triagem', () => {
  const SETOR = '11111111-1111-1111-1111-111111111111';
  const MOTIVO = '22222222-2222-2222-2222-222222222222';
  const ctx = (extra = {}) => ({
    conversationId: 'c-1', contact: { id: 'ct-1' },
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', client: { id: 9 } },
    contracts: [{ id: 17402, address: 'RUA X', plan: '600MB', statusCode: 1 }],
    triagem: { threshold: 0.8, maxQuestions: 2, attempts: 0 },
    origemMensagem: 'texto', resolvidoPelaIa: false, ...extra,
  });
  beforeEach(() => {
    jest.clearAllMocks();
    listSectors.mockResolvedValue([{ id: SETOR, name: 'Financeiro' }]);
    findReasonById.mockResolvedValue({ id: MOTIVO, name: 'Segunda via', active: true });
    concludeAiTriage.mockResolvedValue({ id: 'c-1', triageState: 'completed' });
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null });
  });

  test('validar exige setor UUID, confiança 0-1 e resumo', () => {
    const v = findTool('concluir_triagem').validar;
    expect(v({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.9 }).ok).toBe(true);
    expect(v({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }).ok).toBe(true);
    expect(v({ setorId: 'x', resumo: 'r', confianca: 0.9 }).ok).toBe(false);
    expect(v({ setorId: SETOR, resumo: '', confianca: 0.9 }).ok).toBe(false);
    expect(v({ setorId: SETOR, resumo: 'r', confianca: 1.5 }).ok).toBe(false);
    expect(v({ setorId: SETOR, resumo: 'r', confianca: '0.9' }).ok).toBe(true);
  });

  test('confiança baixa com pergunta sobrando: não conclui e manda perguntar', async () => {
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.5 }, ctx());
    expect(r.concluido).toBe(false);
    expect(r.instrucao).toMatch(/UMA pergunta/);
    expect(concludeAiTriage).not.toHaveBeenCalled();
  });

  test('confiança baixa sem pergunta sobrando: conclui e marca baixa confiança', async () => {
    const c = ctx({ triagem: { threshold: 0.8, maxQuestions: 2, attempts: 2 } });
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.5 }, c);
    expect(r.concluido).toBe(true);
    expect(concludeAiTriage).toHaveBeenCalledWith('c-1', expect.objectContaining({ lowConfidence: true, sectorId: SETOR }));
  });

  test('conclui: grava, prefixa o resumo com o que o código sabe, avisa a fila e instrui uma frase final', async () => {
    const c = ctx({ resolvidoPelaIa: true, origemMensagem: 'áudio' });
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'Cliente pediu boleto.', confianca: 0.95 }, c);
    expect(r).toMatchObject({ concluido: true, setor: 'Financeiro' });
    expect(r.instrucao).toMatch(/uma frase/i);
    const args = concludeAiTriage.mock.calls[0][1];
    expect(args).toMatchObject({ sectorId: SETOR, reasonId: MOTIVO, confidence: 0.95, identifiedBy: 'phone', lowConfidence: false, resolvedByAi: true });
    expect(args.summary).toContain('Setor: Financeiro');
    expect(args.summary).toContain('Motivo: Segunda via');
    expect(args.summary).toContain('Cliente: João');
    expect(args.summary).toContain('Identificação: telefone');
    expect(args.summary).toContain('Origem: áudio');
    expect(args.summary).toContain('Resolvido pela IA');
    expect(args.summary).toContain('Cliente pediu boleto.');
    expect(broadcast).toHaveBeenCalledWith('queue:new', expect.objectContaining({ conversation: expect.any(Object) }));
    expect(c.triagemConcluida).toEqual({ setor: 'Financeiro' });
  });

  test('setor desconhecido ou motivo inativo são recusados', async () => {
    listSectors.mockResolvedValue([]);
    expect((await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }, ctx())).ok).toBe(false);
    listSectors.mockResolvedValue([{ id: SETOR, name: 'F' }]);
    findReasonById.mockResolvedValue({ id: MOTIVO, active: false });
    expect((await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.9 }, ctx())).ok).toBe(false);
  });

  test('conversa que já saiu de pending (atendente assumiu) devolve concluido:false sem quebrar', async () => {
    concludeAiTriage.mockResolvedValue(null);
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }, ctx());
    expect(r.concluido).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('cpf_confirmed é gravado como identificação quando a origem for essa', async () => {
    const c = ctx({ identidade: { nivel: 'forte', origem: 'cpf_confirmed', primeiroNome: 'Ana', client: { id: 1 } } });
    await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }, c);
    expect(concludeAiTriage.mock.calls[0][1].identifiedBy).toBe('cpf_confirmed');
  });
});
