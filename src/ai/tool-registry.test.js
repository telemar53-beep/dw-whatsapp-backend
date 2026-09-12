jest.mock('../integrations/sgp-client');
jest.mock('../sectors/sector.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../conversations/conversation.repository');

const { listTools, findTool, toOpenAiTools } = require('./tool-registry');
const { listSectors } = require('../sectors/sector.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { setConversationSector, setSuggestedReason } = require('../conversations/conversation.repository');

describe('tool-registry', () => {
  test('registers exactly the eight phase-one tools plus the two disabled sensitive ones', () => {
    const nomes = listTools().map((t) => t.nome).sort();
    expect(nomes).toEqual([
      'buscar_cliente', 'consultar_faturas', 'consultar_financeiro', 'consultar_plano',
      'consultar_status_conexao', 'consultar_status_contrato',
      'definir_motivo_atendimento', 'gerar_pix', 'gerar_segunda_via', 'transferir_atendimento',
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

  test('the ownership exemption list is exactly these three tools, by name', () => {
    // Adicionar uma quarta isenção exige editar esta lista — a decisão passa
    // por um revisor em vez de escapar dentro da definição de uma ferramenta.
    const isentas = listTools().filter((t) => t.isentoDeProprietario === true).map((t) => t.nome).sort();
    expect(isentas).toEqual(['buscar_cliente', 'definir_motivo_atendimento', 'transferir_atendimento']);
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
