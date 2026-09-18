jest.mock('../integrations/sgp-client');
jest.mock('../sectors/sector.repository');
jest.mock('../reasons/reason.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
jest.mock('./trust-unlock.repository');
jest.mock('../media/media-storage');
jest.mock('../queue/outbound-queue');
jest.mock('../realtime/socket-server');
jest.mock('../payments/payment-sender');
// Só para o teste de composição do perfil assistente (fix round 2): sem isto,
// o executor de verdade chamaria isToolEnabled contra o banco de verdade
// (ai_tool_permissions), que pode nem ter linha para a ferramenta.
jest.mock('./ai-config.repository');
jest.mock('./triage-close-reason');
jest.mock('../conversations/message.repository');
jest.mock('./openai-client');
jest.mock('../cities/contact-city.service');
jest.mock('../company/company-config.repository');
jest.mock('./receipt-usage.repository');
jest.mock('../city-notices/city-notice.service');

const sgpClient = require('../integrations/sgp-client');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');
const { listTools, findTool, toOpenAiTools, faturaEmAlgumContrato } = require('./tool-registry');
const { listSectors } = require('../sectors/sector.repository');
const { findReasonById } = require('../reasons/reason.repository');
const {
  setConversationSector, setSuggestedReason, concludeAiTriage, getConversationWithContact,
  markPhoneContested, markTriageResolvedByAi, closeConversationByAi, setThirdPartyScope,
} = require('../conversations/conversation.repository');
const { setContactSgpLink } = require('../conversations/contact.repository');
const { saveMediaFile, getMediaFilePath } = require('../media/media-storage');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { enviarPix, enviarBoleto } = require('../payments/payment-sender');
const { isToolEnabled, getAiConfig } = require('./ai-config.repository');
const { motivoDeEncerramentoAtivo } = require('./triage-close-reason');
const { findLatestInboundImage } = require('../conversations/message.repository');
const { analyzeImage } = require('./openai-client');
const { PROMPT_VISAO } = require('./comprovante');
const { preencherCidadePeloSgp } = require('../cities/contact-city.service');
const { getCompanyConfig } = require('../company/company-config.repository');
const { claimReceipt, releaseReceipt, findReceiptUsage } = require('./receipt-usage.repository');
const { enviarAvisoDeCidadeSePreciso } = require('../city-notices/city-notice.service');
const fs = require('fs');
// Não mockado de propósito: os testes de "composição real" (I3, fix round 1)
// precisam do executor de verdade rodando por cima do registro de verdade.
const { executeTool } = require('./tool-executor');
// FERRAMENTAS_TRIAGEM ainda não estava neste arquivo: é exportado por
// ai-orchestrator.js, não por tool-registry.js.
const { FERRAMENTAS_TRIAGEM } = require('./ai-orchestrator');

const SETOR = '11111111-1111-1111-1111-111111111111';
const FATURA_ABERTA = { id: 5, value: 135, dueDate: '2026-09-10', status: 'aberta' };

// A ação principal de cada ferramenta que limpa o escopo de terceiro. Nenhuma
// delas pode ter rodado quando a limpeza falha. Note que são três funções
// diferentes, de dois módulos diferentes — `completeTriage` NÃO serve para
// nenhuma das três: ela pertence ao menu numérico antigo (triage.service.js),
// que é mutuamente exclusivo com a triagem por IA.
const ACAO_PRINCIPAL = {
  concluir_triagem: concludeAiTriage,
  encerrar_atendimento: closeConversationByAi,
  esquecer_identificacao: setContactSgpLink,
};

/** Contexto de um turno de triagem já identificado, com o que cada teste variar. */
function contextoDeTriagemCom(extra = {}) {
  return {
    conversationId: 'c1',
    contact: { id: 'ct1', sgpDocument: '11122233344' },
    contracts: [{ id: 1, address: 'Minha rua' }],
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', client: { id: 5 } },
    ferramentasPermitidas: FERRAMENTAS_TRIAGEM,
    registroFerramentas: [], sgpCache: {}, terceiro: null,
    triagem: { threshold: 0.8, maxQuestions: 2, attempts: 0, noturno: { ativo: false } },
    ...extra,
  };
}

describe('tool-registry', () => {
  test('registers exactly the known tools, sensitive ones included', () => {
    const nomes = listTools().map((t) => t.nome).sort();
    expect(nomes).toEqual([
      'analisar_comprovante', 'buscar_cliente', 'concluir_triagem', 'consultar_faturas',
      'consultar_faturas_todos_contratos', 'consultar_financeiro',
      'consultar_plano', 'consultar_status_conexao', 'consultar_status_contrato',
      'consultar_status_todos_contratos',
      'definir_motivo_atendimento', 'desbloqueio_confianca', 'encerrar_atendimento', 'enviar_boleto',
      'esquecer_identificacao', 'gerar_pix', 'gerar_segunda_via', 'transferir_atendimento',
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

  test('the ownership exemption list is exactly these nine tools, by name', () => {
    // Adicionar uma isenção exige editar esta lista — a decisão passa por um
    // revisor em vez de escapar dentro da definição de uma ferramenta.
    // consultar_faturas_todos_contratos entrou porque não recebe id nenhum do
    // modelo: percorre contexto.contracts, carregado pelo servidor a partir do
    // CPF do próprio contato — não há valor vindo do modelo para conferir.
    // esquecer_identificacao e concluir_triagem entraram pela mesma razão:
    // nenhuma das duas recebe um contratoId (ou qualquer id de posse) do
    // modelo — atuam sobre contexto.identidade/conversationId, que o servidor
    // já resolveu, não sobre algo que precise ser conferido contra os
    // contratos do cliente.
    // encerrar_atendimento entrou pelo mesmo motivo: nao recebe argumento
    // nenhum do modelo e so age sobre contexto.conversationId.
    // consultar_status_todos_contratos entrou pela mesma razao de
    // consultar_faturas_todos_contratos: percorre contexto.contracts e nao
    // recebe id nenhum do modelo.
    // analisar_comprovante entrou pela mesma razão levada ao extremo: ela não
    // tem parâmetro nenhum. A imagem que ela lê é a última que o cliente
    // mandou NESTA conversa, escolhida pelo servidor.
    const isentas = listTools().filter((t) => t.isentoDeProprietario === true).map((t) => t.nome).sort();
    expect(isentas).toEqual([
      'analisar_comprovante', 'buscar_cliente', 'concluir_triagem',
      'consultar_faturas_todos_contratos',
      'consultar_status_todos_contratos', 'definir_motivo_atendimento', 'encerrar_atendimento',
      'esquecer_identificacao', 'transferir_atendimento',
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
    // titularEOutraPessoa entra sempre normalizado (2026-09-16): o default é
    // false, então o vínculo do contato continua sendo gravado como antes.
    expect(tool.validar({ cpf: '529.982.247-25' })).toEqual({ ok: true, args: { cpf: '52998224725', titularEOutraPessoa: false } });
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

  // A ferramenta e o nível de identidade fraca foram removidos: o CPF digitado
  // já basta para deixar a identidade forte (ver describe 'buscar_cliente na
  // triagem' mais abaixo).
  const todasAsFerramentas = () => toOpenAiTools(listTools().map((t) => t.nome));

  test('confirmar_nascimento não existe mais no registro de ferramentas', () => {
    expect(findTool('confirmar_nascimento')).toBeNull();
    expect(todasAsFerramentas().map((t) => t.function.name)).not.toContain('confirmar_nascimento');
  });

  test('nenhuma descrição ou parâmetro de ferramenta menciona nascimento', () => {
    expect(JSON.stringify(todasAsFerramentas())).not.toMatch(/nascimento/i);
  });

  test('buscar_cliente deixa a identidade forte e não devolve proximoPasso', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 9, name: 'MARIA SILVA', document: '52998224725' },
      contracts: [{ id: 1, status: 1, address: 'Rua A' }],
    });
    const contexto = { ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1', contact: { id: 'ct1' }, identidade: { nivel: 'none' } };
    const r = await executeTool('buscar_cliente', { cpf: '52998224725' }, contexto);
    expect(r.ok).toBe(true);
    expect(r.resultado.proximoPasso).toBeUndefined();
    expect(contexto.identidade.nivel).toBe('forte');
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

  // 3º teste real do boleto (2026-09-13): o modelo viu que só um contrato
  // tinha fatura e ainda assim perguntou o endereço. A 2ª via de cada
  // contrato diz o que está em aberto, e a ferramenta devolve a instrução.
  describe('fatura em aberto por contrato, via 2ª via', () => {
    const TRIAGEM = { contracts: [CONTRATO_A, CONTRATO_B], identidade: { nivel: 'forte' } };
    const segundaVia = (aberta) => ({ hasOpenInvoice: aberta, duplicates: aberta ? [{ id: '9' }] : [] });

    beforeEach(() => {
      sgpClient.listInvoices.mockResolvedValue({ faturas: [FATURA] });
    });

    test('só um contrato com fatura: manda entregar dele agora, sem perguntar', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => segundaVia(id === 2));
      const r = await findTool('consultar_faturas_todos_contratos').executar({}, TRIAGEM);
      expect(r.contratosComFaturaEmAberto).toEqual([{ contratoId: 2, endereco: 'AV Y, 2', plano: '300MB' }]);
      expect(r.contratos[0].temFaturaEmAberto).toBe(false);
      expect(r.contratos[1].temFaturaEmAberto).toBe(true);
      expect(r.instrucao).toMatch(/Só o contrato 2 \(AV Y, 2\) tem fatura em aberto/);
      expect(r.instrucao).toMatch(/entregue dele AGORA .* sem perguntar nada/);
    });

    test('mais de um contrato com fatura: manda perguntar pelo endereço', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue(segundaVia(true));
      const r = await findTool('consultar_faturas_todos_contratos').executar({}, TRIAGEM);
      expect(r.contratosComFaturaEmAberto).toHaveLength(2);
      expect(r.instrucao).toMatch(/pergunte de qual endereço/);
    });

    test('nenhum contrato com fatura: manda avisar e concluir para o Financeiro', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue(segundaVia(false));
      const r = await findTool('consultar_faturas_todos_contratos').executar({}, TRIAGEM);
      expect(r.contratosComFaturaEmAberto).toEqual([]);
      expect(r.instrucao).toMatch(/Nenhum contrato tem fatura em aberto/);
      expect(r.instrucao).toMatch(/concluir_triagem/);
    });

    test('falha da 2ª via num contrato vira null, sem esconder os outros', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation((id) => (id === 1 ? Promise.reject(new Error('SGP fora')) : Promise.resolve(segundaVia(true))));
      const r = await findTool('consultar_faturas_todos_contratos').executar({}, TRIAGEM);
      expect(r.contratos[0].temFaturaEmAberto).toBeNull();
      expect(r.contratosComFaturaEmAberto).toEqual([{ contratoId: 2, endereco: 'AV Y, 2', plano: '300MB' }]);
    });

    test('fora da triagem (assistente), traz os dados mas não a instrução', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue(segundaVia(true));
      const r = await findTool('consultar_faturas_todos_contratos').executar({}, { contracts: [CONTRATO_A, CONTRATO_B] });
      expect(r.contratosComFaturaEmAberto).toHaveLength(2);
      expect(r.instrucao).toBeUndefined();
    });
  });
});

// Teste real (2026-09-13): cliente com vários contratos disse "a internet tá
// com problema". O roteiro de Suporte mandava consultar status do contrato E
// da conexão de cada um — 2N chamadas, acima do teto do turno. Esta ferramenta
// cobre todos os contratos numa chamada só.
describe('consultar_status_todos_contratos executar', () => {
  const CONTRATO_A = { id: 1, statusCode: 1, status: 'Ativo', plan: '600MB', address: 'RUA X, 1', login: 'a' };
  const CONTRATO_B = { id: 2, statusCode: 1, status: 'Ativo', plan: '300MB', address: 'AV Y, 2', login: 'b' };
  const SUSPENSO = { id: 3, statusCode: 4, status: 'Suspenso', plan: '100MB', address: 'RUA Z, 3', login: 'c' };
  const TRIAGEM = (contracts) => ({ contracts, identidade: { nivel: 'forte' } });
  const conexao = (status) => ({ status });

  beforeEach(() => jest.clearAllMocks());

  test('declara as marcações da ferramenta sem parâmetros e isenta de dono', () => {
    const tool = findTool('consultar_status_todos_contratos');
    expect(tool.categoria).toBe('CONSULTA');
    expect(tool.isentoDeProprietario).toBe(true);
    expect(tool.exigeIdentidadeForte).toBe(true);
    expect(tool.parametros).toEqual({ type: 'object', properties: {} });
    expect(tool.validar({ contratoId: 999 })).toEqual({ ok: true, args: {} });
  });

  test('sem cliente identificado, responde que precisa de buscar_cliente', async () => {
    const r = await findTool('consultar_status_todos_contratos').executar({}, { contracts: [] });
    expect(r.sucesso).toBe(false);
    expect(r.motivo).toMatch(/buscar_cliente/);
    expect(sgpClient.checkConnection).not.toHaveBeenCalled();
  });

  test('todos ativos e online: uma chamada de conexão por contrato e instrução de perguntar o endereço', async () => {
    sgpClient.checkConnection.mockResolvedValue(conexao(1));
    const r = await findTool('consultar_status_todos_contratos').executar({}, TRIAGEM([CONTRATO_A, CONTRATO_B]));
    expect(sgpClient.checkConnection).toHaveBeenCalledTimes(2);
    expect(r.contratos).toEqual([
      { contratoId: 1, endereco: 'RUA X, 1', plano: '600MB', status: 'ativo', statusLabel: 'Ativo', conexao: 'online' },
      { contratoId: 2, endereco: 'AV Y, 2', plano: '300MB', status: 'ativo', statusLabel: 'Ativo', conexao: 'online' },
    ]);
    expect(r.suspensos).toEqual([]);
    expect(r.offline).toEqual([]);
    expect(r.instrucao).toMatch(/Todos os contratos estão ativos e online/);
    expect(r.instrucao).toMatch(/pergunte também de qual endereço/);
    // Print 2026-09-16: a cliente disse "contratei 500 mega e aparece 20" e a
    // IA respondeu "está sem acesso, com lentidão ou caindo?" — a instrução
    // mandava usar o modelo "ativo e online" mesmo com o problema já relatado.
    expect(r.instrucao).toMatch(/Se o cliente JÁ disse qual é o problema, NÃO pergunte de novo/);
    // Print 2026-09-17: o modelo "ativo e online" saiu três vezes seguidas.
    expect(r.instrucao).toMatch(/Se você já mandou esse modelo nesta conversa, NÃO repita/);
    // O login PPPoE nunca sai daqui: as palavras do modelo vão direto ao cliente.
    expect(JSON.stringify(r)).not.toContain('"login"');
  });

  test('um offline: lista o offline e manda usar o modelo da conexão offline', async () => {
    sgpClient.checkConnection.mockImplementation(async (id) => conexao(id === 2 ? 2 : 1));
    const r = await findTool('consultar_status_todos_contratos').executar({}, TRIAGEM([CONTRATO_A, CONTRATO_B]));
    expect(r.contratos[1].conexao).toBe('offline');
    expect(r.offline).toEqual([{ contratoId: 2, endereco: 'AV Y, 2', plano: '300MB', status: 'ativo', statusLabel: 'Ativo', conexao: 'offline' }]);
    expect(r.instrucao).toMatch(/Conexão offline em: .*2.*AV Y, 2/);
    expect(r.instrucao).toMatch(/modelo da conexão offline/);
  });

  test('um suspenso tem precedência sobre o offline e manda usar o modelo do suspenso', async () => {
    sgpClient.checkConnection.mockResolvedValue(conexao(2));
    const r = await findTool('consultar_status_todos_contratos').executar({}, TRIAGEM([CONTRATO_A, SUSPENSO]));
    expect(r.suspensos).toHaveLength(1);
    expect(r.suspensos[0]).toMatchObject({ contratoId: 3, endereco: 'RUA Z, 3', status: 'suspenso' });
    expect(r.instrucao).toMatch(/Contrato\(s\) suspenso\(s\): .*3.*RUA Z, 3/);
    expect(r.instrucao).toMatch(/modelo do contrato suspenso por falta de pagamento/);
  });

  // O dono: a DW Telecom É o suporte. "Não consegui verificar" é inaceitável.
  test('consulta rejeitada num contrato vira conexao null e proíbe dizer isso ao cliente', async () => {
    sgpClient.checkConnection.mockImplementation((id) => (id === 2 ? Promise.reject(new Error('SGP fora')) : Promise.resolve(conexao(1))));
    const r = await findTool('consultar_status_todos_contratos').executar({}, TRIAGEM([CONTRATO_A, CONTRATO_B]));
    expect(r.contratos[0].conexao).toBe('online');
    expect(r.contratos[1].conexao).toBeNull();
    expect(r.instrucao).toMatch(/não respondeu: NÃO diga isso ao cliente/);
    expect(r.instrucao).toMatch(/Trate como ativo e online/);
  });

  test('conexão desconhecida cai na mesma instrução de não dizer', async () => {
    sgpClient.checkConnection.mockResolvedValue(conexao(99));
    const r = await findTool('consultar_status_todos_contratos').executar({}, TRIAGEM([CONTRATO_A]));
    expect(r.contratos[0].conexao).toBe('desconhecido');
    expect(r.instrucao).toMatch(/NÃO diga isso ao cliente/);
  });

  test('fora da triagem (assistente), traz os dados mas não a instrução', async () => {
    sgpClient.checkConnection.mockResolvedValue(conexao(1));
    const r = await findTool('consultar_status_todos_contratos').executar({}, { contracts: [CONTRATO_A] });
    expect(r.contratos).toHaveLength(1);
    expect(r.instrucao).toBeUndefined();
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

// Task 4: à noite, a ferramenta é quem avisa o cliente antes de escrever no
// SGP e quem devolve as frases do dono — o modelo só repete o que ela mandar.
describe('desbloqueio_confianca — modo noturno', () => {
  const SUSPENSO = { id: 26515, statusCode: 4, status: 'Suspenso', plan: '100MB', address: 'RUA Z', paymentPromisesThisMonth: 0 };
  const FATURA_VENCIDA = { id: 1, status: 'Gerado', statusid: 1, valor: 100, vencimento: '2026-08-30', data_pagamento: null };
  const ID_TRANSACAO = 'E18236120202609131200abcdef123456';
  const COMPROVANTE = { valido: true, contratoId: 26515, faturaId: '4321', valor: 135, data: '2026-09-13', tipo: 'pix', idTransacao: ID_TRANSACAO, motivos: [] };
  const noturno = (extra = {}) => ({
    contracts: [SUSPENSO], contact: { id: 'ct-1' },
    conversationId: 'c-1', channelId: 'ch-1',
    identidade: { nivel: 'forte', primeiroNome: 'Willemberg' },
    triagem: { noturno: { ativo: true, retornoAs: '08:00' } },
    comprovante: COMPROVANTE, ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    listTrustUnlocksByContract.mockResolvedValue([]);
    sgpClient.listInvoices.mockResolvedValue({ faturas: [FATURA_VENCIDA], paginacao: { total: 1 } });
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: true, liberadoDias: 3, protocolo: '9999', motivo: null });
    recordTrustUnlock.mockResolvedValue({ id: 'l-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'm-1' });
    // Padrão: o comprovante ainda não tinha sido usado.
    claimReceipt.mockResolvedValue(true);
    releaseReceipt.mockResolvedValue(undefined);
    // A releitura da conversa (mesma guarda de gerar_pix/enviar_boleto) agora
    // roda antes do aviso: por padrão a conversa segue em triagem.
    // mockReset porque clearAllMocks NÃO apaga implementação — sem isto, o
    // valor de outro describe deste arquivo vazaria para cá.
    getConversationWithContact.mockReset().mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'waiting', triageState: 'pending' });
  });

  test('(a) avisa o cliente ANTES de escrever no SGP e devolve as frases do dono', async () => {
    const ctx = noturno();
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'c-1', channelId: 'ch-1', sentBy: 'ai',
      content: 'Recebi seu comprovante, Willemberg! Como nossa equipe retorna a partir das 08:00, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.',
    });
    // A ordem é a garantia que interessa: o cliente lê o aviso antes de a
    // liberação existir no SGP, e não depois — nem "em vez de".
    expect(enqueueOutboundMessage.mock.invocationCallOrder[0])
      .toBeLessThan(sgpClient.requestTrustUnlock.mock.invocationCallOrder[0]);
    expect(r.liberado).toBe(true);
    expect(r.instrucao).toContain('Prontinho, Willemberg! O desbloqueio em confiança foi realizado');
    expect(r.instrucao).toContain('a partir das 08:00');
    expect(r.instrucao).toContain('Já deixei seu atendimento na fila');
    expect(ctx.desbloqueioRealizado).toBe(true);
    expect(ctx.desbloqueioResultado).toEqual({ liberado: true, dias: 3 });
  });

  // Revisão final do branch: entre o início do turno (a OpenAI, a visão do
  // comprovante, as consultas ao SGP) e o aviso, um atendente pode ter assumido
  // a conversa — ou ela pode ter sido fechada/silenciada/concluída. Sem a
  // releitura, o aviso sairia com um humano já no comando E a liberação
  // aconteceria de verdade no SGP.
  // Um comprovante desbloqueia UMA vez: emprestado a outra pessoa, ele não
  // pode liberar de novo. A reserva acontece ANTES do aviso ao cliente.
  test('reserva o comprovante antes de avisar o cliente e antes de escrever no SGP', async () => {
    const ctx = noturno();
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(claimReceipt).toHaveBeenCalledWith({ transactionId: ID_TRANSACAO, contactId: 'ct-1', contractId: 26515 });
    expect(claimReceipt.mock.invocationCallOrder[0])
      .toBeLessThan(enqueueOutboundMessage.mock.invocationCallOrder[0]);
    expect(r.liberado).toBe(true);
  });

  // A reserva vale enquanto a liberação estiver de pé: recusada a liberação,
  // o comprovante volta a valer — ele não pode ser queimado por uma recusa
  // que não foi do cliente.
  test('SGP recusa a liberação: a reserva do comprovante é devolvida', async () => {
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: false, liberadoDias: null, protocolo: null, motivo: 'contrato com bloqueio judicial' });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno());
    expect(claimReceipt).toHaveBeenCalled();
    expect(releaseReceipt).toHaveBeenCalledWith(ID_TRANSACAO);
    expect(r.liberado).toBe(false);
  });

  test('erro do SGP que não é timeout também devolve a reserva', async () => {
    sgpClient.requestTrustUnlock.mockRejectedValue(new Error('500 Internal Server Error'));
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno())).rejects.toThrow('500 Internal Server Error');
    expect(releaseReceipt).toHaveBeenCalledWith(ID_TRANSACAO);
    erroSpy.mockRestore();
  });

  // Timeout é desfecho DESCONHECIDO: o SGP pode ter liberado. Devolver a
  // reserva aqui deixaria o mesmo comprovante liberar de novo em cima de uma
  // liberação que talvez exista.
  test('timeout do SGP mantém a reserva: o desfecho é desconhecido', async () => {
    sgpClient.requestTrustUnlock.mockRejectedValue(new Error('socket hang up: timeout'));
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno());
    expect(r.indeterminado).toBe(true);
    expect(releaseReceipt).not.toHaveBeenCalled();
    erroSpy.mockRestore();
  });

  test('a devolução da reserva que falha não derruba a resposta ao cliente', async () => {
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: false, liberadoDias: null, protocolo: null, motivo: 'sem autorização' });
    releaseReceipt.mockRejectedValue(new Error('banco fora do ar'));
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno());
    expect(r.liberado).toBe(false);
    expect(r.instrucao).toContain('Não consegui liberar o acesso em confiança agora');
    erroSpy.mockRestore();
  });

  test('liberação bem-sucedida não devolve a reserva', async () => {
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno());
    expect(r.liberado).toBe(true);
    expect(releaseReceipt).not.toHaveBeenCalled();
  });

  test('sem comprovante não há reserva para devolver quando o SGP recusa', async () => {
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: false, liberadoDias: null, protocolo: null, motivo: 'sem autorização' });
    await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno({ comprovante: undefined }));
    expect(releaseReceipt).not.toHaveBeenCalled();
  });

  test('comprovante já utilizado: recusa acolhendo, sem aviso e sem escrita no SGP', async () => {
    claimReceipt.mockResolvedValue(false);
    const ctx = noturno();
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(r.liberado).toBe(false);
    expect(r.motivo).toBe('Este comprovante já foi utilizado.');
    expect(r.instrucao).toContain('a partir das 08:00');
    expect(r.instrucao).toContain('Responda EXATAMENTE neste modelo:');
    expect(ctx.desbloqueioRealizado).toBeFalsy();
  });

  // O resumo da fila diz ONDE o comprovante já tinha sido usado; a frase do
  // cliente, não. O contrato é de outra pessoa.
  describe('comprovante já utilizado: onde a descrição pode aparecer', () => {
    const USADO_EM = new Date('2026-09-14T02:12:00.000Z');
    const DESCRICAO = 'já utilizado no contrato 26515 em 13/09 às 23:12';

    beforeEach(() => {
      claimReceipt.mockResolvedValue(false);
      findReceiptUsage.mockResolvedValue({ contactId: 'ct-9', contractId: 26515, usedAt: USADO_EM });
    });

    test('o resumo interno recebe o motivo com contrato e hora', async () => {
      const ctx = noturno();
      await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
      expect(findReceiptUsage).toHaveBeenCalledWith(ID_TRANSACAO);
      expect(ctx.desbloqueioResultado).toEqual({
        liberado: false, motivo: `Este comprovante já foi utilizado (${DESCRICAO}).`,
      });
    });

    // analisar_comprovante, no mesmo turno, já consultou o uso e guardou a
    // descrição no contexto: repetir a consulta seria uma ida ao banco por
    // nada, no caminho de uma recusa.
    test('com a descrição já no contexto, não vai ao banco de novo', async () => {
      const ctx = noturno({
        comprovante: { ...COMPROVANTE, usoAnterior: { contractId: 26515, usedAt: USADO_EM, descricao: DESCRICAO } },
      });
      await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
      expect(findReceiptUsage).not.toHaveBeenCalled();
      expect(ctx.desbloqueioResultado).toEqual({
        liberado: false, motivo: `Este comprovante já foi utilizado (${DESCRICAO}).`,
      });
    });

    // A garantia que importa: nada do uso anterior pode chegar ao WhatsApp de
    // quem mandou a imagem — nem pela frase pronta, nem pelo motivo que o
    // modelo lê e pode repetir.
    test('a frase do cliente e o motivo devolvido ao modelo ficam sem contrato e sem hora', async () => {
      const ctx = noturno();
      const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
      expect(r.motivo).toBe('Este comprovante já foi utilizado.');
      expect(r.instrucao).toContain('Este comprovante já foi utilizado.');
      for (const texto of [r.instrucao, r.motivo]) {
        expect(texto).not.toContain('26515');
        expect(texto).not.toContain('23:12');
        expect(texto).not.toContain('13/09');
      }
    });

    // O uso existe (o claim falhou), mas a linha sumiu entre uma coisa e
    // outra: a recusa continua de pé, só sem a descrição.
    test('sem uso encontrado, a recusa continua e o resumo fica sem descrição', async () => {
      findReceiptUsage.mockResolvedValue(null);
      const ctx = noturno();
      const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
      expect(r.liberado).toBe(false);
      expect(ctx.desbloqueioResultado).toEqual({ liberado: false, motivo: 'Este comprovante já foi utilizado.' });
    });

    // Banco fora do ar na consulta do uso não pode virar liberação nem erro:
    // a recusa é a mesma, só sem a descrição.
    test('falha ao consultar o uso não derruba a recusa', async () => {
      findReceiptUsage.mockRejectedValue(new Error('banco fora do ar'));
      const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = noturno();
      const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
      expect(r.liberado).toBe(false);
      expect(r.motivo).toBe('Este comprovante já foi utilizado.');
      expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
      expect(ctx.desbloqueioResultado).toEqual({ liberado: false, motivo: 'Este comprovante já foi utilizado.' });
      erroSpy.mockRestore();
    });
  });

  test('comprovante sem id de transação legível: recusa sem reservar nada', async () => {
    const ctx = noturno({ comprovante: { ...COMPROVANTE, idTransacao: null } });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(claimReceipt).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(r.liberado).toBe(false);
    expect(r.motivo).toBe('O comprovante não tem um identificador de transação legível.');
    expect(r.instrucao).toContain('a partir das 08:00');
    expect(ctx.desbloqueioResultado).toEqual({ liberado: false, motivo: 'O comprovante não tem um identificador de transação legível.' });
  });

  // "Paguei, libera" sem imagem nenhuma não tem comprovante para reservar: a
  // regra da casa decide sozinha, como antes.
  test('pedido sem comprovante não exige id de transação', async () => {
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno({ comprovante: undefined }));
    expect(claimReceipt).not.toHaveBeenCalled();
    expect(r.liberado).toBe(true);
  });

  test('conversa que saiu da triagem: nem aviso ao cliente, nem escrita no SGP', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: 'ag-1', status: 'waiting', triageState: 'pending' });
    const ctx = noturno();
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(r).toEqual({ liberado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' });
    expect(ctx.desbloqueioRealizado).toBeFalsy();
  });

  test('(b) sem comprovante no contexto o aviso não diz "Recebi seu comprovante"', async () => {
    await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno({ comprovante: undefined }));
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Willemberg, como nossa equipe retorna a partir das 08:00, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.',
    }));
  });

  test('(c) recusa da regra da casa não avisa nada ao cliente e devolve acolhimento com o motivo', async () => {
    listTrustUnlocksByContract.mockResolvedValue([{ createdAt: new Date(Date.now() - 10 * 86400000) }]);
    const ctx = noturno();
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(r.liberado).toBe(false);
    expect(r.instrucao).toContain('recebi seu comprovante e ele já está registrado');
    expect(r.instrucao).toContain('Não consegui liberar o acesso em confiança agora');
    expect(r.instrucao).toContain(r.motivo);
    expect(ctx.desbloqueioRealizado).toBeFalsy();
  });

  // Revisão final do branch: com dois contratos, o modelo podia conferir o
  // comprovante do contrato A (analisar_comprovante devolve o contrato da
  // fatura que bateu) e pedir a liberação do contrato B. A liberação sairia
  // no contrato errado, com um comprovante que não é dele.
  test('comprovante de outro contrato: recusa apontando o contrato certo, sem gastar a tentativa', async () => {
    const ctx = noturno({
      contracts: [{ ...SUSPENSO, id: 17402 }, { ...SUSPENSO, id: 17405 }],
      comprovante: { ...COMPROVANTE, valido: true, contratoId: 17402 },
    });
    const tool = findTool('desbloqueio_confianca');
    const errado = await tool.executar({ contratoId: 17405 }, ctx);
    expect(errado).toEqual({
      liberado: false,
      motivo: 'O comprovante conferido é da fatura do contrato 17402, não do contrato 17405.',
      instrucao: 'Chame desbloqueio_confianca de novo com contratoId 17402.',
    });
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    // Não é recusa do atendimento: nada vai para o resumo da fila.
    expect(ctx.desbloqueioResultado).toBeUndefined();

    // E a tentativa única não foi gasta: a chamada com o contrato certo, no
    // MESMO contexto, segue o fluxo normal até a liberação.
    const certo = await tool.executar({ contratoId: 17402 }, ctx);
    expect(certo.liberado).toBe(true);
    expect(sgpClient.requestTrustUnlock).toHaveBeenCalledWith(17402);
  });

  test('(d) comprovante que não conferiu recusa sem tocar no SGP', async () => {
    const ctx = noturno({ comprovante: { ...COMPROVANTE, valido: false, motivos: ['valor diferente', 'favorecido não confere'] } });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(sgpClient.listInvoices).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ liberado: false, motivo: 'O comprovante não conferiu: valor diferente; favorecido não confere.' });
    expect(r.instrucao).toContain('a partir das 08:00');
    expect(ctx.desbloqueioRealizado).toBeFalsy();
  });

  // Revisão final do branch: a instrução de recusa vinha num formato diferente
  // da de sucesso — texto corrido, com a ordem "Depois disso chame
  // concluir_triagem" grudada na frase do cliente. Nada impedia o modelo de
  // repetir a ordem ao cliente. Agora os dois caminhos usam o mesmo modelo: a
  // frase do dono entre aspas, a ordem para a IA fora delas.
  test('a instrução de recusa usa o modelo do sucesso: frase do cliente entre aspas, ordem fora', async () => {
    listTrustUnlocksByContract.mockResolvedValue([{ createdAt: new Date(Date.now() - 10 * 86400000) }]);
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno());
    const abertura = 'Responda EXATAMENTE neste modelo: "';
    expect(r.instrucao.startsWith(abertura)).toBe(true);
    const fecho = '" — e chame concluir_triagem para o Financeiro NA MESMA resposta.';
    expect(r.instrucao.endsWith(fecho)).toBe(true);
    const paraOCliente = r.instrucao.slice(abertura.length, r.instrucao.length - fecho.length);
    expect(paraOCliente).toBe(
      `Willemberg, recebi seu comprovante e ele já está registrado para a equipe conferir a partir das 08:00. `
      + `Não consegui liberar o acesso em confiança agora: ${r.motivo} Assim que o pagamento for confirmado, a liberação é automática.`
    );
    // O que o cliente lê não pode conter o nome de uma ferramenta.
    expect(paraOCliente).not.toContain('concluir_triagem');
  });

  test('motivo sem ponto final não emenda na frase seguinte', async () => {
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: false, liberadoDias: null, protocolo: null, motivo: 'contrato com bloqueio judicial' });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, noturno());
    expect(r.instrucao).toContain('contrato com bloqueio judicial. Assim que o pagamento for confirmado');
  });

  test('a recusa do SGP à noite também vem com acolhimento, mesmo sem motivo do SGP', async () => {
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: false, liberadoDias: null, protocolo: null, motivo: null });
    const ctx = noturno();
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    // O aviso já saiu (a regra da casa aprovou); quem recusou foi o SGP.
    expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
    expect(r.liberado).toBe(false);
    expect(r.instrucao).toContain('Não consegui liberar o acesso em confiança agora');
    // Um motivo nulo do SGP não pode virar "undefined" numa frase que o
    // modelo foi mandado repetir ao cliente.
    expect(r.instrucao).not.toMatch(/undefined|null/);
    expect(ctx.desbloqueioRealizado).toBeFalsy();
  });

  // Ruling do fix round 1: a recusa local também gasta a tentativa única, senão
  // o modelo pode insistir com o mesmo comprovante reprovado a rodada inteira.
  test('a recusa por comprovante inválido consome a tentativa única do turno', async () => {
    const ctx = noturno({ comprovante: { ...COMPROVANTE, valido: false, motivos: ['valor diferente'] } });
    const tool = findTool('desbloqueio_confianca');
    const primeira = await tool.executar({ contratoId: 26515 }, ctx);
    expect(primeira.motivo).toMatch(/comprovante não conferiu/);
    const segunda = await tool.executar({ contratoId: 26515 }, ctx);
    expect(segunda.motivo).toMatch(/já foi tentada/);
  });

  // Achado 1 do fix round 1: o resumo da fila só mostrava a recusa se alguém
  // montasse contexto.desbloqueioResultado na mão. Este teste usa as DUAS
  // ferramentas de verdade, no mesmo contexto, como acontece num turno real.
  test('a recusa grava o resultado no contexto e o resumo da fila a mostra', async () => {
    const SETOR_FIN = '11111111-1111-1111-1111-111111111111';
    const MOTIVO_COMP = '22222222-2222-2222-2222-222222222222';
    listTrustUnlocksByContract.mockResolvedValue([{ createdAt: new Date(Date.now() - 10 * 86400000) }]);
    listSectors.mockResolvedValue([{ id: SETOR_FIN, name: 'Financeiro' }]);
    findReasonById.mockResolvedValue({ id: MOTIVO_COMP, name: 'Comprovante', active: true });
    concludeAiTriage.mockResolvedValue({ id: 'c-1', triageState: 'completed' });
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null });

    const ctx = noturno();
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(r.liberado).toBe(false);
    await findTool('concluir_triagem').executar({ setorId: SETOR_FIN, motivoId: MOTIVO_COMP, resumo: 'Cliente mandou comprovante.', confianca: 0.95 }, ctx);
    const summary = concludeAiTriage.mock.calls[0][1].summary;
    expect(summary).toContain(`Desbloqueio em confiança: RECUSADO: ${r.motivo}`);
    expect(summary).toContain('Pendente: conferir pagamento e dar baixa');
  });

  test('a recusa por comprovante inválido também chega ao resumo da fila', async () => {
    const ctx = noturno({ comprovante: { ...COMPROVANTE, valido: false, motivos: ['valor diferente'] } });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(ctx.desbloqueioResultado).toEqual({ liberado: false, motivo: r.motivo });
  });

  test('o resultado indeterminado vira uma recusa explícita no resumo', async () => {
    sgpClient.requestTrustUnlock.mockRejectedValue(Object.assign(new Error('Failed to reach SGP'), { cause: { message: 'timeout of 15000ms exceeded' } }));
    const ctx = noturno();
    await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
    expect(ctx.desbloqueioResultado).toEqual({ liberado: false, motivo: 'não foi possível confirmar a liberação' });
  });

  // Promovido na revisão final: "contrato ativo" era o único desfecho da noite
  // sem frase pronta — o modelo improvisava a resposta a um cliente que acabou
  // de mandar comprovante, e o pagamento não chegava ao resumo da fila.
  describe('contrato ativo (não há bloqueio para liberar)', () => {
    const ATIVO = { id: 26515, statusCode: 1, status: 'Ativo', plan: '100MB', address: 'RUA Z', paymentPromisesThisMonth: 0 };

    test('com comprovante conferido: agradece, registra a baixa e manda concluir', async () => {
      const ctx = noturno({ contracts: [ATIVO] });
      const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
      expect(r.liberado).toBe(false);
      expect(r.instrucao).toBe('Responda EXATAMENTE neste modelo: "Recebi seu comprovante, Willemberg! Seu contrato está ativo, então não há bloqueio para liberar. O pagamento fica registrado para a equipe conferir e dar baixa a partir das 08:00." — e chame concluir_triagem para o Financeiro NA MESMA resposta.');
      expect(ctx.desbloqueioResultado).toEqual({ liberado: false, motivo: 'contrato ativo, não há bloqueio para liberar' });
      expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('sem comprovante: não conclui ainda e puxa o diagnóstico de conexão', async () => {
      const ctx = noturno({ contracts: [ATIVO], comprovante: undefined });
      const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, ctx);
      expect(r.instrucao).toBe('Responda EXATAMENTE neste modelo: "Willemberg, seu contrato está ativo, então não há bloqueio para liberar. Se a internet não estiver funcionando, me conta o que está acontecendo." — não conclua ainda.');
      expect(ctx.desbloqueioResultado).toEqual({ liberado: false, motivo: 'contrato ativo, não há bloqueio para liberar' });
    });

    test('de dia o caminho continua sem instrução nenhuma', async () => {
      const r = await findTool('desbloqueio_confianca').executar({ contratoId: 26515 }, { contracts: [ATIVO], contact: { id: 'ct-1' } });
      expect(r).toEqual({ liberado: false, motivo: 'O contrato não está suspenso (status: ativo). A liberação em confiança só se aplica a contrato suspenso.' });
    });
  });

  test('(e) de dia nada muda: sem aviso ao cliente e sem instrucao', async () => {
    const r = await findTool('desbloqueio_confianca').executar(
      { contratoId: 26515 },
      { contracts: [SUSPENSO], contact: { id: 'ct-1' }, conversationId: 'c-1', channelId: 'ch-1' }
    );
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(r).toEqual({ liberado: true, dias: 3, protocolo: '9999' });
  });
});

describe('esquecer_identificacao', () => {
  beforeEach(() => jest.clearAllMocks());

  test('zera a identidade do turno e o vínculo do contato', async () => {
    const c = {
      identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', dataNascimento: 'x' },
      contracts: [{ id: 1 }],
      contact: { id: 'ct-1', sgpDocument: '1', sgpClientId: 9, sgpContractId: 5, sgpFirstName: 'João' },
      conversationId: 'conv-1',
    };
    const r = await findTool('esquecer_identificacao').executar({}, c);
    expect(r).toEqual({ esquecido: true });
    expect(c.identidade).toMatchObject({ nivel: 'none', origem: 'none', primeiroNome: null, contestado: true });
    expect(c.contracts).toEqual([]);
    expect(c.contact.sgpDocument).toBeNull();
    // Minor (fix round 1): sgpClientId/sgpContractId em memória também
    // precisam zerar — senão um resquício do cliente anterior sobrevive no
    // objeto contact do turno mesmo com o vínculo já apagado no banco.
    expect(c.contact.sgpClientId).toBeNull();
    expect(c.contact.sgpContractId).toBeNull();
    // Mesmo motivo para o nome: um resquício em memória faria o backfill da
    // resolução seguinte achar que o contato já tem nome guardado.
    expect(c.contact.sgpFirstName).toBeNull();
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', { sgpClientId: null, sgpContractId: null, sgpDocument: null, sgpFirstName: null });
  });

  test('marca o telefone contestado na conversa, para o próximo turno não repetir o mesmo telefone no SGP', async () => {
    const c = {
      identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João' },
      contracts: [],
      contact: { id: 'ct-1', sgpDocument: '1', sgpClientId: 9, sgpContractId: 5 },
      conversationId: 'conv-1',
    };
    await findTool('esquecer_identificacao').executar({}, c);
    expect(markPhoneContested).toHaveBeenCalledWith('conv-1');
  });

  test('markPhoneContested falhando não derruba a limpeza em memória nem do vínculo', async () => {
    markPhoneContested.mockRejectedValue(new Error('db fora'));
    const c = {
      identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João' },
      contracts: [{ id: 1 }],
      contact: { id: 'ct-1', sgpDocument: '1', sgpClientId: 9, sgpContractId: 5 },
      conversationId: 'conv-1',
    };
    const r = await findTool('esquecer_identificacao').executar({}, c);
    expect(r).toEqual({ esquecido: true });
    expect(c.identidade.nivel).toBe('none');
    expect(setContactSgpLink).toHaveBeenCalled();
  });

  // I6 (revisão final do branch inteiro): sem lista fixa e sem identidade no
  // contexto, o turno é do assistente clássico — esquecer_identificacao só
  // faz sentido na recepcionista da triagem.
  test('fora do perfil de triagem (sem lista fixa e sem identidade), recusa sem tocar nada', async () => {
    const c = { contact: { id: 'ct-1', sgpDocument: '1', sgpClientId: 9, sgpContractId: 5 }, conversationId: 'conv-1' };
    const r = await findTool('esquecer_identificacao').executar({}, c);
    expect(r).toEqual({ ok: false, erro: 'esquecer_identificacao is only available during AI triage' });
    expect(setContactSgpLink).not.toHaveBeenCalled();
    expect(markPhoneContested).not.toHaveBeenCalled();
  });
});

// Print 2026-09-16: "quero a fatura de Jureildson" + CPF dele → a IA disse
// "SEU contrato tem uma fatura em aberto" e o código gravou o vínculo do
// contato da Agnieska com o cadastro do Jureildson (nome, contratos, cidade).
// No próximo atendimento ela seria tratada como ele. Entregar o boleto é
// certo (o site do SGP faz o mesmo só com o CPF); o que não pode é o contato
// mudar de dono.
describe('buscar_cliente com o CPF de outra pessoa (titularEOutraPessoa)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 77, name: 'JUREILDSON SOUZA', document: '90460835315' },
      contracts: [{ id: 51, login: 'l', plan: 'p', statusCode: 1, address: 'RUA B, 2' }],
    });
  });

  const ctxTerceiro = () => ({
    conversationId: 'conv-1', channelId: 'ch-1', contact: { id: 'ct-1' },
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'Agnieska', contracts: [] },
  });

  test('não grava o vínculo do contato nem a cidade, e mantém o primeiro nome de quem fala', async () => {
    const c = ctxTerceiro();
    await findTool('buscar_cliente').executar({ cpf: '90460835315', titularEOutraPessoa: true }, c);
    expect(setContactSgpLink).not.toHaveBeenCalled();
    expect(preencherCidadePeloSgp).not.toHaveBeenCalled();
    expect(c.contact.sgpDocument).toBeUndefined();
    expect(c.identidade.primeiroNome).toBe('Agnieska');
  });

  // Substituída em 2026-09-18 (Task 6): até então este teste provava a
  // elevação indevida (nivel forte + contratos do titular dentro de
  // contexto.identidade), que era exatamente o bug. Agora contexto.identidade
  // sai intocado — ver describe('escopo de terceiro') logo abaixo, teste
  // "buscar_cliente de terceiro NUNCA eleva a identidade de quem está
  // falando", que prova o objeto inteiro intocado, e "buscar_cliente de
  // terceiro cria o escopo..." para onde os contratos passaram a ir
  // (contexto.terceiro, não contexto.identidade).

  test('a instrução proíbe "seu contrato" e manda dizer de quem é', async () => {
    const r = await findTool('buscar_cliente').executar({ cpf: '90460835315', titularEOutraPessoa: true }, ctxTerceiro());
    expect(r.instrucao).toMatch(/NUNCA diga "seu contrato"/);
    expect(r.instrucao).toMatch(/Jureildson/);
    expect(r.instrucao).toMatch(/registre no resumo que quem pediu não é o titular/);
  });

  test('sem o parâmetro, nada muda: o vínculo continua sendo gravado', async () => {
    const c = { conversationId: 'conv-1', channelId: 'ch-1', contact: { id: 'ct-1' }, identidade: { nivel: 'none', origem: 'none' } };
    await findTool('buscar_cliente').executar({ cpf: '90460835315' }, c);
    expect(setContactSgpLink).toHaveBeenCalled();
    expect(c.identidade.primeiroNome).toBe('Jureildson');
  });

  test('validar aceita o booleano e ignora lixo', () => {
    const v = findTool('buscar_cliente').validar;
    expect(v({ cpf: '90460835315', titularEOutraPessoa: true }).args).toEqual({ cpf: '90460835315', titularEOutraPessoa: true });
    expect(v({ cpf: '90460835315' }).args).toEqual({ cpf: '90460835315', titularEOutraPessoa: false });
    expect(v({ cpf: '90460835315', titularEOutraPessoa: 'sim' }).args).toEqual({ cpf: '90460835315', titularEOutraPessoa: false });
  });
});

// Ciclo de vida do escopo de terceiro (Task 6): criado por buscar_cliente com
// titularEOutraPessoa, persistido na conversa por 30 minutos, e limpo ao
// identificar o próprio contato, esquecer a identificação, concluir a triagem
// ou encerrar o atendimento. Nunca eleva contexto.identidade nem substitui
// contexto.contracts (que continua sendo só os contratos do próprio contato).
describe('escopo de terceiro', () => {
  // Arma explicitamente o caminho feliz de concluir_triagem/encerrar_atendimento/
  // esquecer_identificacao: sem isto, os testes deste describe dependiam de mocks
  // NÃO-Once deixados por describes de ~200 linhas acima (ex.: um
  // listSectors.mockResolvedValue de um teste de desbloqueio_confianca cujo id de
  // setor coincidia com SETOR por acaso — jest.clearAllMocks() reseta contagem de
  // chamadas, não a implementação). Rodando com `-t` (sem os describes anteriores)
  // esse acaso não acontece e concluir_triagem estourava em listSectors().find.
  // markPhoneContested precisa de mockReset() porque describe('esquecer_identificacao',
  // ...), mais acima, deixa um mockRejectedValue (não-Once) armado num teste próprio.
  beforeEach(() => {
    jest.clearAllMocks();
    listSectors.mockResolvedValue([{ id: SETOR, name: 'Financeiro' }]);
    getConversationWithContact.mockResolvedValue({
      id: 'c1', status: 'waiting', triageState: 'pending', assignedAgentId: null, aiTriageResolvedByAi: true,
    });
    concludeAiTriage.mockResolvedValue({ id: 'c1' });
    closeConversationByAi.mockResolvedValue({ id: 'c1' });
    motivoDeEncerramentoAtivo.mockResolvedValue('motivo-1');
    markPhoneContested.mockReset().mockResolvedValue();
  });

  test('buscar_cliente de terceiro cria o escopo e NÃO toca em contexto.contracts', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
      contracts: [{ id: 77, status: 1, address: 'Rua da Maria' }],
    });
    const proprios = [{ id: 1, address: 'Minha rua' }];
    const contexto = {
      ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1',
      contact: { id: 'ct1', sgpDocument: null }, contracts: proprios,
      identidade: { nivel: 'forte', primeiroNome: 'João', origem: 'phone' },
    };

    const r = await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);

    expect(r.ok).toBe(true);
    expect(contexto.contracts).toBe(proprios);                 // intocado
    expect(contexto.terceiro.contratos).toEqual([{ id: 77 }]);
    expect(contexto.identidade.primeiroNome).toBe('João');     // quem fala continua sendo quem fala
    expect(setContactSgpLink).not.toHaveBeenCalled();          // o terceiro nao vira dono do contato
    expect(setThirdPartyScope).toHaveBeenCalledWith('c1', expect.objectContaining({ nome: 'Maria', contratos: [77] }));
  });

  // Digitar o CPF de outra pessoa nao pode promover ninguem. Ate 2026-09-17 este
  // ramo escrevia nivel: 'forte' em contexto.identidade, elevando quem nem era
  // cliente. A autorizacao mora no escopo, nunca na identidade do solicitante.
  test('buscar_cliente de terceiro NUNCA eleva a identidade de quem está falando', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
      contracts: [{ id: 77, status: 1 }],
    });
    const identidade = { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false };
    // Cópia congelada ANTES da chamada: contexto.identidade é o MESMO objeto
    // que `identidade` referencia, então comparar contra `identidade` depois
    // seria comparar o objeto com ele mesmo — passaria sempre, mesmo que o
    // executor mutasse os campos in place (ex.: contexto.identidade.contracts
    // = contracts). `original` é o único jeito de provar "intocado" de verdade.
    const original = structuredClone(identidade);
    const contexto = {
      ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1',
      contact: { id: 'ct1', sgpDocument: null }, contracts: [], identidade,
    };

    await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);

    expect(contexto.identidade).toEqual(original);   // objeto inteiro intocado
    expect(contexto.identidade.nivel).toBe('none');
  });

  // Falha fechado: sem gravacao no banco nao ha autorizacao neste turno.
  test('se a gravação do escopo falhar, a ferramenta falha e o escopo não vale', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
      contracts: [{ id: 77, status: 1 }],
    });
    setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
    const contexto = contextoDeTriagemCom({ contracts: [] });

    const r = await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);

    expect(r.ok).toBe(false);
    expect(contexto.terceiro).toBeNull();
  });

  test.each(['concluir_triagem', 'encerrar_atendimento', 'esquecer_identificacao'])(
    'se a limpeza do escopo falhar, %s aborta em vez de seguir com a autorização viva',
    async (nome) => {
      setThirdPartyScope.mockRejectedValueOnce(new Error('banco fora'));
      const contexto = contextoDeTriagemCom({ terceiro: { nome: 'Maria', contratos: [{ id: 77 }] } });
      const args = nome === 'concluir_triagem' ? { setorId: SETOR, resumo: 'x', confianca: 0.9 } : {};

      const r = await executeTool(nome, args, contexto);

      expect(r.ok).toBe(false);
      // A ação principal NÃO pode ter rodado: é isso que prova que o abort
      // acontece ANTES dela, e não depois. `r.ok === false` sozinho não provaria
      // — a ferramenta poderia ter concluído a triagem e falhado em seguida,
      // deixando a conversa fora da triagem com a autorização de terceiro viva.
      expect(ACAO_PRINCIPAL[nome]).not.toHaveBeenCalled();
      expect(contexto.terceiro).not.toBeNull();   // nada foi dado por limpo
    }
  );

  // Endereco do titular e dado cadastral de outra pessoa: nao vai ao modelo.
  test('o retorno do buscar_cliente de terceiro não traz endereço nem status do titular', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 99, name: 'MARIA SILVA', document: '52998224725' },
      contracts: [{ id: 77, status: 4, address: 'Rua da Maria' }],
    });
    const contexto = {
      ferramentasPermitidas: ['buscar_cliente'], conversationId: 'c1',
      contact: { id: 'ct1' }, contracts: [], identidade: { nivel: 'forte', primeiroNome: 'João' },
    };
    const r = await executeTool('buscar_cliente', { cpf: '52998224725', titularEOutraPessoa: true }, contexto);
    expect(JSON.stringify(r.resultado)).not.toMatch(/Rua da Maria/);
    expect(r.resultado.contratos).toEqual([{ id: 77 }]);
  });

  test.each([
    ['concluir_triagem', { setorId: SETOR, resumo: 'x', confianca: 0.9 }],
    ['encerrar_atendimento', {}],
    ['esquecer_identificacao', {}],
  ])('%s limpa o escopo de terceiro', async (nome, args) => {
    const contexto = contextoDeTriagemCom({ terceiro: { nome: 'Maria', contratos: [{ id: 77 }] } });
    const r = await executeTool(nome, args, contexto);
    expect(setThirdPartyScope).toHaveBeenCalledWith(contexto.conversationId, null);
    // Caminho feliz de verdade, não só "não travou": a ferramenta precisa ter
    // concluído a própria ação (não parado em algum mock desarmado por acaso) e
    // deixado a limpeza refletida no contexto.
    expect(r.ok).toBe(true);
    expect(contexto.terceiro).toBeNull();
    expect(ACAO_PRINCIPAL[nome]).toHaveBeenCalled();
  });

  test('buscar_cliente sem a marcação de terceiro limpa um escopo anterior', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 5, name: 'JOAO', document: '11122233344' }, contracts: [{ id: 1, status: 1 }],
    });
    const contexto = contextoDeTriagemCom({ terceiro: { nome: 'Maria', contratos: [{ id: 77 }] } });
    await executeTool('buscar_cliente', { cpf: '11122233344' }, contexto);
    expect(contexto.terceiro).toBeNull();
    expect(setThirdPartyScope).toHaveBeenCalledWith(contexto.conversationId, null);
  });
});

describe('buscar_cliente no perfil de triagem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sem identidade no contexto (assistente) não muda nada e persiste o vínculo de imediato', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9, name: 'X SOBRENOME', document: '1' }, contracts: [{ id: 5, login: 'l', plan: 'p', statusCode: 1 }] });
    const c = { contact: { id: 'ct-1' } };
    const r = await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(c.identidade).toBeUndefined();
    expect(sgpClient.findClientRecord).not.toHaveBeenCalled();
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', { sgpClientId: 9, sgpContractId: 5, sgpDocument: '11122233344', sgpFirstName: 'X' });
    expect(c.contact.sgpDocument).toBe('11122233344');
    expect(r.cliente.nome).toBe('X SOBRENOME');
  });

  // C1 (fix round 1): sem o guard de client_already_identified (que agora
  // fica inerte na triagem, já que sgpDocument não é mais setado ali), o
  // modelo podia varrer CPFs à vontade. O teto é três distintos por turno.
  test('recusa a terceira busca de CPF distinto no mesmo turno', async () => {
    sgpClient.lookupClientByCpf.mockImplementation((cpf) => Promise.resolve({ client: { id: 1, name: 'A', document: cpf }, contracts: [] }));
    sgpClient.findClientRecord.mockResolvedValue({ total: 0, cliente: null });
    const c = { contact: { id: 'ct-1' }, identidade: { nivel: 'none', origem: 'none' } };
    const tool = findTool('buscar_cliente');

    const r1 = await tool.executar({ cpf: '11111111111' }, c);
    const r2 = await tool.executar({ cpf: '22222222222' }, c);
    const r3 = await tool.executar({ cpf: '33333333333' }, c);

    expect(r1.cliente).toBeDefined();
    expect(r2.cliente).toBeDefined();
    expect(r3).toEqual({ ok: false, erro: 'CPF lookup limit reached for this turn' });
    expect(sgpClient.lookupClientByCpf).toHaveBeenCalledTimes(2);
  });

  test('repetir o mesmo CPF não consome o limite', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 1, name: 'A', document: '11111111111' }, contracts: [] });
    sgpClient.findClientRecord.mockResolvedValue({ total: 0, cliente: null });
    const c = { contact: { id: 'ct-1' }, identidade: { nivel: 'none', origem: 'none' } };
    const tool = findTool('buscar_cliente');

    await tool.executar({ cpf: '11111111111' }, c);
    await tool.executar({ cpf: '11111111111' }, c);
    const r3 = await tool.executar({ cpf: '11111111111' }, c);

    expect(r3.cliente).toBeDefined();
    expect(sgpClient.lookupClientByCpf).toHaveBeenCalledTimes(3);
  });
});

describe('buscar_cliente na triagem com a data de nascimento dispensada (padrao)', () => {
  // Decisao do dono (2026-09-14): "o dado mais importante e o CPF; no site do
  // SGP o cliente loga so com ele". O CPF digitado ja identifica e libera
  // boleto/PIX direto, sem confirmação nenhuma.
  const CLIENTE = { client: { id: 9, name: 'MARIA SOUZA', document: '1' }, contracts: [{ id: 5, statusCode: 1, address: 'RUA X, 10' }] };

  beforeEach(() => {
    jest.clearAllMocks();
    sgpClient.lookupClientByCpf.mockResolvedValue(CLIENTE);
  });

  function ctx() {
    return { conversationId: 'conv-1', channelId: 'ch-1', contact: { id: 'ct-1' }, identidade: { nivel: 'none', origem: 'none' } };
  }

  test('o CPF digitado ja deixa a identidade FORTE, sem consultar data de nascimento', async () => {
    const c = ctx();
    await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(c.identidade).toMatchObject({ nivel: 'forte', origem: 'cpf', primeiroNome: 'Maria' });
    // Sem exigencia, a data de nascimento nem e buscada no SGP.
    expect(sgpClient.findClientRecord).not.toHaveBeenCalled();
  });

  test('persiste o vinculo do contato na hora, com o primeiro nome', async () => {
    const c = ctx();
    await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(setContactSgpLink).toHaveBeenCalledWith('ct-1', {
      sgpClientId: 9, sgpContractId: 5, sgpDocument: '11122233344', sgpFirstName: 'Maria',
    });
    expect(c.contact.sgpDocument).toBe('11122233344');
  });

  test('preenche a cidade e manda o aviso da cidade, como a confirmacao fazia', async () => {
    const c = ctx();
    await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(preencherCidadePeloSgp).toHaveBeenCalledWith(c.contact, CLIENTE.contracts);
    expect(enviarAvisoDeCidadeSePreciso).toHaveBeenCalledWith({
      contact: c.contact, conversationId: 'conv-1', channelId: 'ch-1',
    });
  });

  test('devolve os contratos com endereco e a instrucao de seguir', async () => {
    sgpClient.lookupClientByCpf.mockResolvedValue({
      client: { id: 9, name: 'MARIA SOUZA', document: '1' },
      contracts: [{ id: 5, statusCode: 1, address: 'RUA X, 10', login: 'joao123', plan: '600MB' }, { id: 6, statusCode: 4, address: 'AV Y, 20' }],
    });
    const c = ctx();
    const r = await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(r).toEqual({
      cliente: { nome: 'Maria' },
      contratos: [
        { id: 5, status: 'ativo', endereco: 'RUA X, 10' },
        { id: 6, status: 'suspenso', endereco: 'AV Y, 20' },
      ],
      instrucao: 'Cliente identificado. Siga com o pedido. Com um contrato só, use-o sem perguntar; com vários, pergunte pelo endereço.',
    });
    // Na triagem as palavras do modelo vao direto ao cliente: sobrenome e
    // login PPPoE continuam fora.
    expect(JSON.stringify(r)).not.toContain('SOUZA');
    expect(JSON.stringify(r)).not.toContain('joao123');
  });

  test('falha ao preencher a cidade nao derruba a identificacao ja persistida', async () => {
    preencherCidadePeloSgp.mockRejectedValueOnce(new Error('db fora'));
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const c = ctx();
    const r = await findTool('buscar_cliente').executar({ cpf: '11122233344' }, c);
    expect(c.identidade.nivel).toBe('forte');
    expect(r.cliente).toEqual({ nome: 'Maria' });
    expect(erroSpy.mock.calls.map((a) => JSON.stringify(a)).join(' ')).not.toContain('11122233344');
    erroSpy.mockRestore();
  });
});

describe('enviar_boleto', () => {
  // primeiroNome no fixture desde 2026-09-17: a instrução da entrega passa a
  // lembrar o modelo de chamar o cliente pelo nome.
  const ctx = () => ({ conversationId: 'c-1', channelId: 'ch-1', contracts: [{ id: 17402 }], identidade: { nivel: 'forte', primeiroNome: 'Willemberg' } });
  beforeEach(() => {
    jest.clearAllMocks();
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '9', dueDate: '2026-09-20', value: 89.9, boletoLink: 'https://x/b.pdf', pixCode: 'pix', barCode: '836100000012' }] });
    sgpClient.downloadBoletoPdf.mockResolvedValue(Buffer.from('%PDF'));
    saveMediaFile.mockResolvedValue('abc.pdf');
    enqueueOutboundMessage.mockResolvedValue({ id: 'm-9' });
    enviarBoleto.mockReset().mockResolvedValue([{ id: 'm-cartao' }, { id: 'm-linha' }]);
    // I1 (revisão final do branch inteiro): a conversa ainda em triagem, sem
    // dono, é o cenário padrão em que o envio deve seguir em frente.
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'waiting', triageState: 'pending' });
  });
  test('baixa o PDF, manda como documento com sentBy ai e marca resolvido', async () => {
    const c = ctx();
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, c);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c-1', channelId: 'ch-1', messageType: 'document', mediaPath: 'abc.pdf',
      mediaMimeType: 'application/pdf', mediaFilename: 'boleto.pdf', sentBy: 'ai',
    }));
    expect(r).toMatchObject({ enviado: true, valor: 89.9, vencimento: '2026-09-20', linhaDigitavelEnviada: true });
    expect(r.instrucao).toMatch(/linha digitável em mensagem separada/);
    expect(r.instrucao).toMatch(/sem emoji/);
    // O modelo de frase do dono sai DAQUI, depois do envio real (teste real
    // 2026-09-15: no prompt, o modelo copiava a frase sem enviar nada). Com
    // um contrato só, sem endereço.
    // Print 2026-09-17: a IA entregou o boleto sem chamar a cliente pelo nome,
    // mesmo tendo acabado de identificar pelo CPF. Ficou robótico.
    expect(r.instrucao).toContain('Comece pelo primeiro nome do cliente ("Prontinho, Willemberg!")');
    expect(r.instrucao).toContain('Responda EXATAMENTE no modelo, sem emoji: "Enviei acima o boleto em PDF e com a linha digitável. É só pagar pelo aplicativo do seu banco, copiando a linha digitável, ou em qualquer lotérica. Se tiver alguma dificuldade, me avise que eu te ajudo!"');
    expect(r.instrucao).not.toMatch(/endereço/);
    // A linha digitável vai junto, sozinha numa mensagem, pelo mesmo sender do
    // botão "Cód Barras" da atendente.
    expect(enviarBoleto).toHaveBeenCalledWith({
      conversationId: 'c-1', channelId: 'ch-1', sentBy: 'ai',
      fatura: expect.objectContaining({ barCode: '836100000012' }),
    });
    expect(c.resolvidoPelaIa).toBe(true);
  });

  test('sem linha digitável na fatura, manda só o PDF e avisa o modelo', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '9', dueDate: '2026-09-20', value: 89.9, boletoLink: 'https://x/b.pdf', pixCode: 'pix', barCode: null }] });
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
    expect(enviarBoleto).not.toHaveBeenCalled();
    expect(r).toMatchObject({ enviado: true, linhaDigitavelEnviada: false });
    expect(r.instrucao).not.toMatch(/linha digitável em mensagem separada/);
  });

  test('falha ao mandar a linha digitável não desfaz a entrega do PDF', async () => {
    enviarBoleto.mockRejectedValue(new Error('fila indisponível'));
    const c = ctx();
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, c);
    expect(r).toMatchObject({ enviado: true, linhaDigitavelEnviada: false });
    expect(c.resolvidoPelaIa).toBe(true);
  });
  // A entrega tem de ficar GRAVADA, não só em contexto.resolvidoPelaIa: o
  // cliente pode responder "só isso, obrigado" no turno seguinte, e é a flag
  // persistida que autoriza encerrar_atendimento ali.
  test('marca a entrega no banco (markTriageResolvedByAi), além do contexto do turno', async () => {
    await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
    expect(markTriageResolvedByAi).toHaveBeenCalledWith('c-1');
  });
  test('sem fatura em aberto, não envia nada', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: false, duplicates: [] });
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
    expect(r).toEqual({ enviado: false, motivo: 'Nenhuma fatura em aberto em nenhum contrato do cliente.' });
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  // I1 (revisão final do branch inteiro): entre o início do turno e este
  // ponto (depois de já ter baixado o PDF), um atendente pode ter assumido a
  // conversa, ou ela pode ter sido fechada/silenciada — reler antes de
  // enviar o PDF de verdade é a última linha de defesa.
  describe('I1: relê a conversa antes de enviar, e recusa se ela saiu da triagem', () => {
    test('atendente já assumiu: recusa e não envia nada', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: 'ag-1', status: 'waiting', triageState: 'pending' });
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ enviado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' });
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('conversa fechada: recusa e não envia nada', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'closed', triageState: 'pending' });
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(false);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('conversa silenciada: recusa e não envia nada', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'silent', triageState: 'pending' });
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(false);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('triagem já concluída (triageState não é mais pending): recusa e não envia nada', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'waiting', triageState: 'completed' });
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(false);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('conversa não encontrada: recusa e não envia nada', async () => {
      getConversationWithContact.mockResolvedValue(null);
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(false);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('conversa ainda em triagem, pending, sem dono: envia normalmente', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'waiting', triageState: 'pending' });
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(true);
      expect(enqueueOutboundMessage).toHaveBeenCalled();
    });
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
  // Task 4: à noite desbloqueio_confianca entra na lista da triagem, e a
  // identidade 'fraca' (CPF digitado, sem data de nascimento) também carrega
  // contratos. Sem este gate, quem digitasse o CPF de outra pessoa liberaria o
  // contrato dela. Fora da triagem (assistente, humano no comando) o gate é
  // inerte, então nada muda para o atendente.
  test('desbloqueio_confianca também exige identidade forte', () => {
    expect(findTool('desbloqueio_confianca').exigeIdentidadeForte).toBe(true);
  });
  // gerar_pix mudou de "sugere pro modelo escrever" pra "envia de verdade"
  // quando o turno está na triagem (mesma virada de enviar_boleto): o cartão
  // (valor + vencimento) e o código PIX copia e cola vão em mensagens
  // separadas, na ordem certa, direto ao cliente.
  describe('gerar_pix', () => {
    beforeEach(() => {
      sgpClient.getDuplicateInvoice.mockResolvedValue({
        hasOpenInvoice: true,
        duplicates: [{ id: '9', value: 135, dueDate: '2026-09-15', pixCode: '000201-pix-emv', barCode: 'b' }],
      });
      enviarPix.mockResolvedValue([{ id: 'm-cartao' }, { id: 'm-codigo' }]);
    });

    test('(a) na triagem, envia via enviarPix com sentBy ai e devolve enviado sem pixCopiaCola', async () => {
      const c = ctx();
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, c);
      expect(enviarPix).toHaveBeenCalledWith({
        conversationId: 'c-1', channelId: 'ch-1',
        fatura: { id: '9', value: 135, dueDate: '2026-09-15', pixCode: '000201-pix-emv', barCode: 'b' },
        sentBy: 'ai',
      });
      expect(r.enviado).toBe(true);
      expect(r.valor).toBe(135);
      expect(r.vencimento).toBe('2026-09-15');
      expect(r).not.toHaveProperty('pixCopiaCola');
      expect(c.resolvidoPelaIa).toBe(true);
      expect(markTriageResolvedByAi).toHaveBeenCalledWith('c-1');
      // Modelo de frase do dono, devolvido só depois do envio real; com um
      // contrato só, sem endereço.
      expect(r.instrucao).toContain('Comece pelo primeiro nome do cliente ("Prontinho, Willemberg!")');
      expect(r.instrucao).toContain('Responda EXATAMENTE no modelo: "Enviei acima o PIX. É só copiar o código e colar na opção "PIX Copia e Cola" do aplicativo do seu banco. Se tiver alguma dificuldade, me avise que eu te ajudo!"');
    });

    // I1b (fix round 1) também vale aqui: fora da triagem não há guarda nem
    // instrução pro modelo saber quando é seguro entregar — então continua
    // no modo assistente/humano-no-comando, sem tocar o sender.
    test('(b) fora da triagem, continua devolvendo pixCopiaCola e não chama o sender', async () => {
      const r = await findTool('gerar_pix').executar(
        { contratoId: 17402 },
        { conversationId: 'c-1', channelId: 'ch-1', contracts: [{ id: 17402 }] }
      );
      expect(r).toEqual({ sucesso: true, valor: 135, vencimento: '2026-09-15', pixCopiaCola: '000201-pix-emv' });
      expect(enviarPix).not.toHaveBeenCalled();
    });

    test('(c) conversa saiu da triagem: não envia nada', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: 'ag-1', status: 'waiting', triageState: 'pending' });
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ enviado: false, motivo: 'A conversa saiu da triagem; não envie nada. Encaminhe.' });
      expect(enviarPix).not.toHaveBeenCalled();
    });

    test('(d) fatura sem código PIX no SGP: sucesso false, sem chamar o sender', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue({
        hasOpenInvoice: true,
        duplicates: [{ id: '9', value: 135, dueDate: '2026-09-15', pixCode: null }],
      });
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ sucesso: false, motivo: 'Fatura sem código PIX no SGP' });
      expect(enviarPix).not.toHaveBeenCalled();
    });

    test('sem fatura em aberto: sucesso false', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: false, duplicates: [] });
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ sucesso: false, motivo: 'Nenhuma fatura em aberto em nenhum contrato do cliente.' });
      expect(enviarPix).not.toHaveBeenCalled();
    });
  });

  // Minor (revisão final do branch inteiro): gerar_segunda_via não marcava
  // resolvidoPelaIa, ao contrário de gerar_pix — o resumo da triagem então
  // nunca dizia "Resolvido pela IA" quando o cliente só tinha pedido o
  // boleto (e não o PIX).
  test('gerar_segunda_via no perfil de triagem também marca resolvidoPelaIa', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '1', dueDate: 'd', value: 1, barCode: 'b', boletoLink: 'l' }] });
    const c = ctx();
    await findTool('gerar_segunda_via').executar({ contratoId: 17402 }, c);
    expect(c.resolvidoPelaIa).toBe(true);
  });

  // I1b (fix round 1): enviar_boleto ENVIA de verdade (não sugere) — fora da
  // triagem não há confirmar_nascimento nem instrução para o modelo saber
  // quando é seguro, então a ferramenta se recusa por conta própria.
  test('sem contexto.identidade (fora da triagem), recusa e não toca o SGP', async () => {
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, { conversationId: 'c-1', channelId: 'ch-1', contracts: [{ id: 17402 }] });
    expect(r).toEqual({ ok: false, erro: 'enviar_boleto is only available during AI triage' });
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});

// Teste real 2026-09-13: cliente com dois contratos, fatura em aberto só num
// deles. O modelo chamou gerar_pix no contrato ERRADO e respondeu "não
// encontrei fatura em aberto" — apesar de o prompt mandar consultar todos os
// contratos antes. A garantia passa a estar no código: a ferramenta procura
// nos demais contratos DO PRÓPRIO CONTATO antes de dizer que não há nada.
describe('fatura em qualquer contrato do cliente (gerar_pix / enviar_boleto / gerar_segunda_via)', () => {
  const CONTRATOS = [{ id: 17402, address: 'RUA J.K., 544' }, { id: 17405, address: 'AGENOR COSTA, 523' }];
  const ctx = (contracts = CONTRATOS) => ({
    conversationId: 'c-1', channelId: 'ch-1', contracts, identidade: { nivel: 'forte' },
  });
  const comFatura = (id, valor) => ({
    hasOpenInvoice: true,
    duplicates: [{ id: `f-${id}`, value: valor, dueDate: '2026-09-20', pixCode: `pix-${id}`, barCode: `b-${id}`, boletoLink: `https://x/${id}.pdf` }],
  });
  const semFatura = { hasOpenInvoice: false, duplicates: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    sgpClient.downloadBoletoPdf.mockResolvedValue(Buffer.from('%PDF'));
    saveMediaFile.mockResolvedValue('abc.pdf');
    enqueueOutboundMessage.mockResolvedValue({ id: 'm-9' });
    enviarPix.mockResolvedValue([{ id: 'm-cartao' }, { id: 'm-codigo' }]);
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'waiting', triageState: 'pending' });
  });

  describe('gerar_pix', () => {
    test('(a) contrato pedido sem fatura e o outro com: entrega a do outro e diz qual', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => (id === 17405 ? comFatura(17405, 135) : semFatura));
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(true);
      expect(r.contratoUsado).toEqual({ contratoId: 17405, endereco: 'AGENOR COSTA, 523' });
      expect(r.valor).toBe(135);
      expect(enviarPix).toHaveBeenCalledWith(expect.objectContaining({
        fatura: expect.objectContaining({ id: 'f-17405', pixCode: 'pix-17405' }), sentBy: 'ai',
      }));
      // Mais de um contrato: o modelo de frase cita o endereço do ponto entregue.
      expect(r.instrucao).toContain('Responda EXATAMENTE no modelo: "Enviei acima o PIX referente ao seu contrato do endereço AGENOR COSTA, 523. É só copiar o código e colar na opção "PIX Copia e Cola" do aplicativo do seu banco. Se tiver alguma dificuldade, me avise que eu te ajudo!"');
    });

    test('(b) contrato pedido já tem fatura: entrega essa sem consultar o outro', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => comFatura(id, id === 17402 ? 100 : 200));
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(true);
      expect(r.valor).toBe(100);
      expect(r).not.toHaveProperty('contratoUsado');
      expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledTimes(1);
      expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith(17402);
    });

    test('(c) nenhum contrato com fatura: diz que não há em nenhum e não envia nada', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue(semFatura);
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ sucesso: false, motivo: 'Nenhuma fatura em aberto em nenhum contrato do cliente.' });
      expect(enviarPix).not.toHaveBeenCalled();
    });

    test('(d) mais de um outro contrato com fatura: devolve os endereços e não envia nada', async () => {
      const contratos = [...CONTRATOS, { id: 17410, address: 'AV. BRASIL, 10' }];
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => (id === 17402 ? semFatura : comFatura(id, 50)));
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx(contratos));
      expect(r.sucesso).toBe(false);
      expect(r.motivo).toBe('Este contrato não tem fatura em aberto, mas outros têm.');
      expect(r.contratosComFatura).toEqual([
        expect.objectContaining({ contratoId: 17405, endereco: 'AGENOR COSTA, 523' }),
        expect.objectContaining({ contratoId: 17410, endereco: 'AV. BRASIL, 10' }),
      ]);
      expect(r.instrucao).toMatch(/gerar_pix/);
      expect(enviarPix).not.toHaveBeenCalled();
    });

    test('(e) a consulta do outro contrato falha: diz que a consulta foi incompleta e não envia nada', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => {
        if (id === 17402) return semFatura;
        throw new Error('SGP fora do ar');
      });
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ sucesso: false, motivo: 'Nenhuma fatura em aberto encontrada; a consulta de um dos contratos falhou.' });
      expect(enviarPix).not.toHaveBeenCalled();
    });

    // O assistente clássico (humano no comando) também se beneficia da busca,
    // mas continua só sugerindo o código — sem enviar nada ao cliente.
    test('fora da triagem, acha no outro contrato e devolve contratoUsado sem enviar', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => (id === 17405 ? comFatura(17405, 135) : semFatura));
      const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, { conversationId: 'c-1', channelId: 'ch-1', contracts: CONTRATOS });
      expect(r).toEqual({
        sucesso: true, valor: 135, vencimento: '2026-09-20', pixCopiaCola: 'pix-17405',
        contratoUsado: { contratoId: 17405, endereco: 'AGENOR COSTA, 523' },
      });
      expect(enviarPix).not.toHaveBeenCalled();
    });
  });

  describe('enviar_boleto', () => {
    test('(a) contrato pedido sem fatura e o outro com: envia o boleto do outro', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => (id === 17405 ? comFatura(17405, 135) : semFatura));
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r.enviado).toBe(true);
      expect(r.valor).toBe(135);
      expect(r.contratoUsado).toEqual({ contratoId: 17405, endereco: 'AGENOR COSTA, 523' });
      expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://x/17405.pdf');
      expect(enqueueOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({ messageType: 'document', sentBy: 'ai' }));
      expect(r.instrucao).toContain('"Enviei acima o boleto referente ao seu contrato do endereço AGENOR COSTA, 523, em PDF e com a linha digitável. É só pagar pelo aplicativo do seu banco, copiando a linha digitável, ou em qualquer lotérica. Se tiver alguma dificuldade, me avise que eu te ajudo!"');
    });

    test('(b) contrato pedido já tem fatura: envia essa sem consultar o outro', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => comFatura(id, id === 17402 ? 100 : 200));
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r).toMatchObject({ enviado: true, valor: 100, vencimento: '2026-09-20' });
      expect(r.contratoUsado).toBeUndefined();
      // Sem troca de contrato, mas com mais de um ponto: o endereço ainda é
      // citado (regra do dono: "cite o endereço só quando ele tiver mais de um contrato").
      expect(r.instrucao).toContain('Enviei acima o boleto referente ao seu contrato do endereço RUA J.K., 544, em PDF e com a linha digitável.');
      expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledTimes(1);
      expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://x/17402.pdf');
    });

    test('(c) nenhum contrato com fatura: diz que não há em nenhum e não envia nada', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue(semFatura);
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ enviado: false, motivo: 'Nenhuma fatura em aberto em nenhum contrato do cliente.' });
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('(d) mais de um outro contrato com fatura: devolve os endereços e não envia nada', async () => {
      const contratos = [...CONTRATOS, { id: 17410, address: 'AV. BRASIL, 10' }];
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => (id === 17402 ? semFatura : comFatura(id, 50)));
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx(contratos));
      expect(r.enviado).toBe(false);
      expect(r.motivo).toBe('Este contrato não tem fatura em aberto, mas outros têm.');
      expect(r.contratosComFatura).toEqual([
        expect.objectContaining({ contratoId: 17405, endereco: 'AGENOR COSTA, 523' }),
        expect.objectContaining({ contratoId: 17410, endereco: 'AV. BRASIL, 10' }),
      ]);
      expect(r.instrucao).toMatch(/enviar_boleto/);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('(e) a consulta do outro contrato falha: diz que a consulta foi incompleta e não envia nada', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => {
        if (id === 17402) return semFatura;
        throw new Error('SGP fora do ar');
      });
      const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ enviado: false, motivo: 'Nenhuma fatura em aberto encontrada; a consulta de um dos contratos falhou.' });
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });
  });

  describe('gerar_segunda_via', () => {
    test('(a) contrato pedido sem fatura e o outro com: devolve a do outro e diz qual', async () => {
      sgpClient.getDuplicateInvoice.mockImplementation(async (id) => (id === 17405 ? comFatura(17405, 135) : semFatura));
      const r = await findTool('gerar_segunda_via').executar({ contratoId: 17402 }, ctx());
      expect(r.temFaturaAberta).toBe(true);
      expect(r.faturas).toEqual([{ faturaId: 'f-17405', vencimento: '2026-09-20', valor: 135, linhaDigitavel: 'b-17405', linkBoleto: 'https://x/17405.pdf' }]);
      expect(r.contratoUsado).toEqual({ contratoId: 17405, endereco: 'AGENOR COSTA, 523' });
    });

    test('(c) nenhum contrato com fatura: diz que não há em nenhum', async () => {
      sgpClient.getDuplicateInvoice.mockResolvedValue(semFatura);
      const r = await findTool('gerar_segunda_via').executar({ contratoId: 17402 }, ctx());
      expect(r).toEqual({ temFaturaAberta: false, faturas: [], motivo: 'Nenhuma fatura em aberto em nenhum contrato do cliente.' });
    });
  });

  // O fallback procura a fatura em OUTROS contratos quando o pedido não tem.
  // Com contexto.contracts (próprios) e contexto.terceiro.contratos (de um
  // terceiro consultado) povoados ao mesmo tempo no turno — o caso real de
  // uma conversa que já resolveu os dois —, ele não pode atravessar a
  // fronteira em NENHUM sentido: nem entregar o boleto do próprio cliente
  // quando o pedido era do terceiro, nem o contrário. Chama
  // faturaEmAlgumContrato direto (não uma ferramenta), para testar o
  // resolvedor de escopo sem depender de qual ferramenta o usa.
  describe('a fronteira entre o escopo próprio e o de terceiro nunca é atravessada pelo fallback', () => {
    test('pedido no contrato do terceiro não cai para os contratos próprios', async () => {
      const contexto = {
        contracts: [{ id: 1 }, { id: 2 }],
        terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
      };
      // Um dos contratos PRÓPRIOS (id 2) tem fatura em aberto: se a fronteira
      // vazasse, seria exatamente essa fatura — a do cliente, não a do
      // terceiro — que sairia como resposta ao pedido do contrato 77.
      sgpClient.getDuplicateInvoice.mockImplementation((id) => Promise.resolve(
        id === 2 ? comFatura(2, 50) : semFatura,
      ));
      const busca = await faturaEmAlgumContrato(77, contexto);
      expect(busca.trocouContrato).toBe(false);
      expect(busca.semFaturaEmNenhum).toBe(true);
      expect(busca.contratoId).toBe(77);
      expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(1);
      expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(2);
    });

    test('pedido num contrato próprio não cai para o contrato do terceiro', async () => {
      const contexto = {
        contracts: [{ id: 1 }],
        terceiro: { nome: 'Maria', contratos: [{ id: 77 }] },
      };
      // O único contrato do TERCEIRO (id 77) tem fatura em aberto: se a
      // fronteira vazasse, o cliente receberia o boleto do marido/esposa ao
      // pedir o próprio.
      sgpClient.getDuplicateInvoice.mockImplementation((id) => Promise.resolve(
        id === 77 ? comFatura(77, 50) : semFatura,
      ));
      const busca = await faturaEmAlgumContrato(1, contexto);
      expect(busca.trocouContrato).toBe(false);
      expect(busca.semFaturaEmNenhum).toBe(true);
      expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(77);
    });
  });
});

describe('tool-executor + enviar_boleto (composição real, I3 fix round 1)', () => {
  beforeEach(() => jest.clearAllMocks());

  // I3: os testes do executor usavam findTool mockado (toolFake) — trocar a
  // ordem das checagens no executor de verdade não quebraria nenhum deles.
  // Este teste roda o registro E o executor de verdade, então prova a
  // composição: o gate de identidade forte tem que recusar ANTES de
  // enviar_boleto.executar chegar a chamar qualquer coisa (SGP, fila).
  test('identidade fraca com perfil fixo (triagem) recusa antes de enviar nada', async () => {
    const contexto = {
      conversationId: 'c-1', channelId: 'ch-1',
      contracts: [{ id: 17402 }], identidade: { nivel: 'fraca' },
      ferramentasPermitidas: ['enviar_boleto'],
    };
    const resultado = await executeTool('enviar_boleto', { contratoId: 17402 }, contexto);
    expect(resultado.motivo).toBe('identity_not_confirmed');
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});

// Promovido na revisão final do branch: desbloqueio_confianca é a ferramenta
// mais perigosa do registro e a única que age no serviço do cliente à noite.
// Os testes dela até aqui chamavam tool.executar direto — o gate de identidade
// forte vive no executor, então uma troca de ordem lá (ou a marcação
// exigeIdentidadeForte sumindo daqui) não quebrava nada. Este roda o registro
// E o executor de verdade.
describe('tool-executor + desbloqueio_confianca (composição real)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('à noite, identidade fraca é recusada antes de qualquer chamada ao SGP', async () => {
    const contexto = {
      conversationId: 'c-1', channelId: 'ch-1',
      contracts: [{ id: 26515, statusCode: 4, status: 'Suspenso', plan: '100MB', address: 'RUA Z', paymentPromisesThisMonth: 0 }],
      contact: { id: 'ct-1' },
      // CPF digitado, data de nascimento não confirmada: sem o gate, quem
      // digitasse o CPF de outra pessoa liberaria o contrato dela.
      identidade: { nivel: 'fraca', primeiroNome: 'Willemberg' },
      triagem: { noturno: { ativo: true, retornoAs: '08:00' } },
      ferramentasPermitidas: ['desbloqueio_confianca'],
    };
    const resultado = await executeTool('desbloqueio_confianca', { contratoId: 26515 }, contexto);
    expect(resultado.motivo).toBe('identity_not_confirmed');
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(sgpClient.listInvoices).not.toHaveBeenCalled();
    expect(listTrustUnlocksByContract).not.toHaveBeenCalled();
    // Nem o aviso "vou verificar a possibilidade" chega ao cliente.
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});

// Fix round 2: consultar_faturas_todos_contratos devolve valor em aberto,
// vencimento e endereço — dado sensível demais para uma identidade fraca
// (CPF ainda não confirmado) na triagem, onde o modelo repassa a resposta
// direto ao cliente. consultar_status_contrato/consultar_status_conexao
// continuam abertos com fraca de propósito (classificação de
// Reativação/Suporte depende deles e nenhum carrega valor).
describe('tool-executor + consultar_faturas_todos_contratos (composição real, fix round 2)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('identidade fraca no perfil de triagem recusa e não chama o SGP', async () => {
    const contexto = {
      contracts: [{ id: 1, statusCode: 1, plan: '600MB', address: 'RUA X' }],
      identidade: { nivel: 'fraca' },
      ferramentasPermitidas: ['consultar_faturas_todos_contratos'],
    };
    const resultado = await executeTool('consultar_faturas_todos_contratos', {}, contexto);
    expect(resultado.motivo).toBe('identity_not_confirmed');
    expect(sgpClient.listInvoices).not.toHaveBeenCalled();
  });

  test('identidade forte no perfil de triagem roda normalmente', async () => {
    sgpClient.listInvoices.mockResolvedValue({ faturas: [] });
    const contexto = {
      contracts: [{ id: 1, statusCode: 1, plan: '600MB', address: 'RUA X' }],
      identidade: { nivel: 'forte' },
      ferramentasPermitidas: ['consultar_faturas_todos_contratos'],
    };
    const resultado = await executeTool('consultar_faturas_todos_contratos', {}, contexto);
    expect(resultado.ok).toBe(true);
    expect(sgpClient.listInvoices).toHaveBeenCalledTimes(1);
  });

  test('perfil assistente (sem identidade, sem lista fixa) continua sem a marcação atrapalhando', async () => {
    isToolEnabled.mockResolvedValue(true);
    sgpClient.listInvoices.mockResolvedValue({ faturas: [] });
    const contexto = { contracts: [{ id: 1, statusCode: 1, plan: '600MB', address: 'RUA X' }] };
    const resultado = await executeTool('consultar_faturas_todos_contratos', {}, contexto);
    expect(resultado.ok).toBe(true);
    expect(sgpClient.listInvoices).toHaveBeenCalledTimes(1);
  });
});

// Relato do dono 2026-09-17: cliente com duas faturas em aberto (uma vencida e
// uma a vencer) recebeu a que AINDA vai vencer. A entrega é sempre a mais
// antiga — a que venceu primeiro é a que tira o cliente do atraso.
describe('fatura entregue é sempre a mais antiga', () => {
  const SETOR_X = '11111111-1111-1111-1111-111111111111';
  const ctx = () => ({
    conversationId: 'c-1', channelId: 'ch-1', contracts: [{ id: 17402 }], identidade: { nivel: 'forte' },
  });
  // Ordem embaralhada de propósito: o SGP não garante ordenação.
  const DUAS = {
    hasOpenInvoice: true,
    duplicates: [
      { id: 'nova', dueDate: '2026-10-05', value: 100, barCode: 'b-nova', pixCode: 'pix-nova', boletoLink: 'https://x/nova.pdf' },
      { id: 'antiga', dueDate: '2026-08-20', value: 100, barCode: 'b-antiga', pixCode: 'pix-antiga', boletoLink: 'https://x/antiga.pdf' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sgpClient.downloadBoletoPdf.mockResolvedValue(Buffer.from('%PDF'));
    saveMediaFile.mockResolvedValue('abc.pdf');
    enqueueOutboundMessage.mockResolvedValue({ id: 'm-9' });
    enviarBoleto.mockReset().mockResolvedValue([{ id: 'm-c' }, { id: 'm-l' }]);
    enviarPix.mockReset().mockResolvedValue([{ id: 'm-c' }]);
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, status: 'waiting', triageState: 'pending' });
  });

  test('enviar_boleto baixa e envia a fatura vencida, não a que ainda vai vencer', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue(DUAS);
    const r = await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
    expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://x/antiga.pdf');
    expect(r.vencimento).toBe('2026-08-20');
    expect(enviarBoleto).toHaveBeenCalledWith(expect.objectContaining({ fatura: expect.objectContaining({ id: 'antiga' }) }));
  });

  test('gerar_pix envia o código da fatura vencida', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue(DUAS);
    const r = await findTool('gerar_pix').executar({ contratoId: 17402 }, ctx());
    expect(enviarPix).toHaveBeenCalledWith(expect.objectContaining({ fatura: expect.objectContaining({ id: 'antiga', pixCode: 'pix-antiga' }) }));
    expect(r.vencimento).toBe('2026-08-20');
  });

  test('gerar_segunda_via lista as faturas da mais antiga para a mais nova', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue(DUAS);
    const r = await findTool('gerar_segunda_via').executar({ contratoId: 17402 }, ctx());
    expect(r.faturas.map((f) => f.faturaId)).toEqual(['antiga', 'nova']);
  });

  test('data em DD/MM/AAAA também é ordenada certo', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({
      hasOpenInvoice: true,
      duplicates: [
        { id: 'nova', dueDate: '05/10/2026', value: 100, barCode: 'b', pixCode: 'p', boletoLink: 'https://x/nova.pdf' },
        { id: 'antiga', dueDate: '20/08/2026', value: 100, barCode: 'b', pixCode: 'p', boletoLink: 'https://x/antiga.pdf' },
      ],
    });
    await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
    expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://x/antiga.pdf');
  });

  test('sem data legível, a ordem que o SGP mandou é mantida', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({
      hasOpenInvoice: true,
      duplicates: [
        { id: 'primeira', dueDate: null, value: 100, barCode: 'b', pixCode: 'p', boletoLink: 'https://x/1.pdf' },
        { id: 'segunda', dueDate: null, value: 100, barCode: 'b', pixCode: 'p', boletoLink: 'https://x/2.pdf' },
      ],
    });
    await findTool('enviar_boleto').executar({ contratoId: 17402 }, ctx());
    expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://x/1.pdf');
  });
});

describe('concluir_triagem', () => {
  const SETOR = '11111111-1111-1111-1111-111111111111';
  const MOTIVO = '22222222-2222-2222-2222-222222222222';
  const ctx = (extra = {}) => ({
    conversationId: 'c-1', contact: { id: 'ct-1' },
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', nome: 'João Da Silva Pereira', client: { id: 9 } },
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
    // Minor (fix round 1): Number(true) === 1, que passava batido na faixa
    // 0-1 antes desta checagem de tipo.
    expect(v({ setorId: SETOR, resumo: 'r', confianca: true }).ok).toBe(false);
  });

  // Task 9 (2026-09-17): o gate de baixa_confianca foi removido por completo
  // de concluir_triagem.executar — confiança baixa nunca mais bloqueia a
  // conclusão nem gera pergunta ao cliente. Os três testes que exercitavam
  // esse gate (bloqueia com pergunta sobrando; preserva o escopo de terceiro
  // na saída antecipada por baixa_confianca; conclui só quando attempts
  // esgota) testavam um comportamento que deixou de existir e foram
  // apagados. A garantia nova — confiança baixa nunca bloqueia, em nenhum
  // estado de attempts, e continua marcada como (BAIXA) no resumo — está em
  // 'tool-executor + concluir_triagem — confiança nunca bloqueia a conclusão
  // (Task 9)', mais abaixo neste arquivo.

  test('conclui: grava, prefixa o resumo com o que o código sabe, avisa a fila e instrui uma frase final', async () => {
    const c = ctx({ resolvidoPelaIa: true, origemMensagem: 'áudio' });
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'Cliente pediu boleto.', confianca: 0.95 }, c);
    expect(r).toMatchObject({ concluido: true, setor: 'Financeiro' });
    expect(r.instrucao).toMatch(/uma frase/i);
    const args = concludeAiTriage.mock.calls[0][1];
    expect(args).toMatchObject({ sectorId: SETOR, reasonId: MOTIVO, confidence: 0.95, identifiedBy: 'phone', lowConfidence: false, resolvedByAi: true });
    expect(args.summary).toContain('Setor: Financeiro');
    expect(args.summary).toContain('Motivo: Segunda via');
    expect(args.summary).toContain('Cliente: João Da Silva Pereira (SGP 9)');
    expect(args.summary).toContain('Identificação: telefone');
    expect(args.summary).toContain('Origem: áudio');
    expect(args.summary).toContain('Resolvido pela IA');
    expect(args.summary).toContain('Cliente pediu boleto.');
    expect(broadcast).toHaveBeenCalledWith('queue:new', expect.objectContaining({ conversation: expect.any(Object) }));
    expect(c.triagemConcluida).toEqual({ setor: 'Financeiro' });
  });

  test('o resumo lista as ferramentas usadas e o que devolveram', async () => {
    const c = ctx({ registroFerramentas: [{ nome: 'enviar_boleto', resultado: '{"enviado":false,"motivo":"Nenhuma fatura em aberto"}' }] });
    await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'Pediu boleto.', confianca: 0.9 }, c);
    expect(concludeAiTriage.mock.calls[0][1].summary).toContain('Ferramentas: enviar_boleto → {"enviado":false,"motivo":"Nenhuma fatura em aberto"}');
  });

  test('setor desconhecido ou motivo inativo são recusados', async () => {
    listSectors.mockResolvedValue([]);
    expect((await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }, ctx())).ok).toBe(false);
    listSectors.mockResolvedValue([{ id: SETOR, name: 'F' }]);
    findReasonById.mockResolvedValue({ id: MOTIVO, active: false });
    expect((await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.9 }, ctx())).ok).toBe(false);
  });

  // Correção 2026-09-18 (re-revisão): mesma prova que já existia para
  // encerrar_atendimento, agora simétrica — cobre as outras duas saídas
  // antecipadas que ficam ANTES da guarda (setor desconhecido, motivo
  // inativo), não só baixa_confianca. Sem isto, uma regressão que movesse a
  // guarda para entre a checagem de motivo e a de confiança baixa destruiria
  // o escopo nestes dois ramos sem quebrar nenhum teste.
  test.each([
    ['setor desconhecido', () => listSectors.mockResolvedValue([])],
    ['motivo inativo', () => findReasonById.mockResolvedValue({ id: MOTIVO, active: false })],
  ])('recusado por %s: preserva o escopo de terceiro e não chama setThirdPartyScope', async (_nome, armar) => {
    armar();
    const terceiro = { nome: 'Maria', contratos: [{ id: 77 }] };
    const c = ctx({ terceiro });
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.9 }, c);
    expect(r.ok).toBe(false);
    expect(setThirdPartyScope).not.toHaveBeenCalled();
    expect(c.terceiro).toBe(terceiro);
  });

  test('conversa que já saiu de pending (atendente assumiu) devolve concluido:false sem quebrar', async () => {
    concludeAiTriage.mockResolvedValue(null);
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }, ctx());
    expect(r.concluido).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });


  // A entrega pode ter acontecido num turno ANTERIOR: contexto.resolvidoPelaIa
  // nasce false a cada turno, então só a flag persistida sabe disso.
  test('resumo diz "Resolvido pela IA" quando a entrega foi num turno anterior', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null, aiTriageResolvedByAi: true });
    await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }, ctx({ resolvidoPelaIa: false }));
    const args = concludeAiTriage.mock.calls[0][1];
    expect(args.resolvedByAi).toBe(true);
    expect(args.summary).toContain('Resolvido pela IA');
  });

  // I6 (revisão final do branch inteiro): mesma guarda de
  // esquecer_identificacao — sem ela, o cartão de permissões do assistente
  // clássico bastaria para concluir uma "triagem" que nunca existiu.
  test('fora do perfil de triagem (sem lista fixa e sem identidade), recusa sem concluir nada', async () => {
    const c = { conversationId: 'c-1', contact: { id: 'ct-1' }, contracts: [], triagem: { threshold: 0.8, maxQuestions: 2, attempts: 0 } };
    const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: null, resumo: 'r', confianca: 0.9 }, c);
    expect(r).toEqual({ ok: false, erro: 'concluir_triagem is only available during AI triage' });
    expect(concludeAiTriage).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  describe('modo noturno', () => {
    const NOTURNO = { threshold: 0.8, maxQuestions: 4, attempts: 0, noturno: { ativo: true, retornoAs: '08:00' } };

    test('à noite a frase final promete a equipe a partir da hora de retorno e o resumo abre com o turno noturno', async () => {
      const c = ctx({ triagem: NOTURNO });
      const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'Cliente pediu boleto.', confianca: 0.95 }, c);
      expect(r.concluido).toBe(true);
      expect(r.instrucao).toMatch(/a partir das 08:00/);
      expect(r.instrucao).not.toMatch(/um atendente continua daqui/);
      // O atendente que pega a conversa de manhã precisa ver, na primeira
      // linha, que ela foi atendida sozinha de madrugada.
      expect(concludeAiTriage.mock.calls[0][1].summary).toMatch(/^Modo noturno · \d{2}:\d{2}\n/);
    });

    // Quem pega a conversa de manhã precisa ver, no resumo, o que a IA leu do
    // comprovante e o que ela fez com o contrato — senão a baixa do pagamento
    // depende de alguém reabrir a conversa inteira.
    test('o resumo noturno leva o comprovante, o desbloqueio e a pendência', async () => {
      const c = ctx({
        triagem: NOTURNO,
        comprovante: { valido: true, tipo: 'pix', valor: 135, data: '2026-09-13', faturaId: '4321', contratoId: 17402, motivos: [] },
        desbloqueioResultado: { liberado: true, dias: 3 },
      });
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'Cliente mandou comprovante.', confianca: 0.95 }, c);
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      expect(summary).toContain('Comprovante (visão): pix R$ 135,00 em 13/09/2026 — conferido, fatura 4321 do contrato 17402');
      expect(summary).toContain('Desbloqueio em confiança: REALIZADO (3 dias)');
      expect(summary).toContain('Pendente: conferir pagamento e dar baixa');
    });

    test('comprovante reprovado e desbloqueio recusado aparecem com o motivo', async () => {
      const c = ctx({
        triagem: NOTURNO,
        comprovante: { valido: false, tipo: 'outro', valor: 90, data: '2026-09-13', faturaId: null, contratoId: null, motivos: ['valor não corresponde a nenhuma fatura em aberto'] },
        desbloqueioResultado: { liberado: false, motivo: 'Só é possível uma liberação em confiança a cada 30 dias.' },
      });
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.95 }, c);
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      expect(summary).toContain('NÃO conferiu: valor não corresponde a nenhuma fatura em aberto');
      expect(summary).not.toContain('fatura null');
      expect(summary).toContain('Desbloqueio em confiança: RECUSADO: Só é possível uma liberação em confiança a cada 30 dias.');
    });

    // Mesma armadilha do fix de round 1 da Task 3: valor nulo não pode virar
    // "R$ 0,00" no resumo — o atendente daria baixa num valor inventado.
    test('valor e data não lidos não viram zero nem "null" no resumo', async () => {
      const c = ctx({
        triagem: NOTURNO,
        comprovante: { valido: false, tipo: 'outro', valor: null, data: null, faturaId: null, contratoId: null, motivos: ['não parece um comprovante'] },
      });
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.95 }, c);
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      expect(summary).not.toMatch(/R\$ 0,00/);
      expect(summary).not.toMatch(/em null/);
      expect(summary).toContain('Pendente: conferir pagamento e dar baixa');
    });

    test('sem comprovante e sem desbloqueio, o resumo noturno não ganha linhas novas', async () => {
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.95 }, ctx({ triagem: NOTURNO }));
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      expect(summary).not.toContain('Comprovante (visão)');
      expect(summary).not.toContain('Desbloqueio em confiança');
      expect(summary).not.toContain('Pendente:');
    });

    test('de dia, a frase final e o resumo seguem como hoje', async () => {
      const r = await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'Cliente pediu boleto.', confianca: 0.95 }, ctx());
      expect(r.instrucao).toMatch(/um atendente continua daqui/);
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      expect(summary.startsWith('Setor: Financeiro')).toBe(true);
      expect(summary).not.toMatch(/Modo noturno/);
    });
  });

  // De dia a leitura também existe (Parte 2), e o que ela apurou tem de chegar
  // à atendente do mesmo jeito: no topo do resumo, com a pendência da baixa.
  describe('comprovante lido de dia', () => {
    test('o comprovante e a pendência abrem o resumo, sem marca de noturno', async () => {
      const c = ctx({
        comprovante: { valido: true, tipo: 'pix', valor: 135, data: '2026-09-13', faturaId: '4321', contratoId: 17402, motivos: [] },
      });
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'Cliente mandou comprovante.', confianca: 0.95 }, c);
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      const linhas = summary.split(String.fromCharCode(10));
      expect(linhas[0]).toBe('Comprovante (visão): pix R$ 135,00 em 13/09/2026 — conferido, fatura 4321 do contrato 17402');
      expect(linhas[1]).toBe('Pendente: conferir pagamento e dar baixa');
      expect(summary).not.toMatch(/Modo noturno/);
      // O desbloqueio é da noite: de dia não há linha nenhuma a respeito.
      expect(summary).not.toContain('Desbloqueio em confiança');
      expect(summary).toContain('Setor: Financeiro');
    });

    test('comprovante já usado antes: a linha ganha o aviso com contrato e hora', async () => {
      const c = ctx({
        comprovante: {
          valido: true, tipo: 'pix', valor: 135, data: '2026-09-13', faturaId: '98765', contratoId: 26515, motivos: [],
          usoAnterior: { contractId: 26515, usedAt: new Date('2026-09-14T02:12:00.000Z'), descricao: 'já utilizado no contrato 26515 em 13/09 às 23:12' },
        },
      });
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.95 }, c);
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      expect(summary.split(String.fromCharCode(10))[0]).toBe(
        'Comprovante (visão): pix R$ 135,00 em 13/09/2026 — conferido, fatura 98765 do contrato 26515 — ⚠ já utilizado no contrato 26515 em 13/09 às 23:12'
      );
    });

    test('sem uso anterior, a linha não ganha aviso nenhum', async () => {
      const c = ctx({
        comprovante: { valido: true, tipo: 'pix', valor: 135, data: '2026-09-13', faturaId: '4321', contratoId: 17402, motivos: [], usoAnterior: null },
      });
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.95 }, c);
      expect(concludeAiTriage.mock.calls[0][1].summary).not.toContain('⚠');
    });

    test('sem comprovante, o resumo de dia não ganha linha nenhuma', async () => {
      await findTool('concluir_triagem').executar({ setorId: SETOR, motivoId: MOTIVO, resumo: 'r', confianca: 0.95 }, ctx());
      const summary = concludeAiTriage.mock.calls[0][1].summary;
      expect(summary).not.toContain('Comprovante (visão)');
      expect(summary).not.toContain('Pendente:');
    });
  });
});

// A confiança é um palpite do modelo sobre si mesmo. Até 2026-09-17 um
// palpite baixo bloqueava concluir_triagem e forçava mais uma pergunta ao
// cliente (o gate removido em tool-registry.js). Roda pelo executor de
// verdade (executeTool), não só tool.executar, porque é na composição
// registro+executor que a checagem de perfil de triagem entra no caminho —
// mesmo motivo dos outros describes 'tool-executor + X (composição real)'
// deste arquivo. beforeEach próprio de propósito: nada aqui depende de mock
// armado em outro describe (rodar isolado com `-t` tem que bastar).
describe('tool-executor + concluir_triagem — confiança nunca bloqueia a conclusão (Task 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listSectors.mockResolvedValue([{ id: SETOR, name: 'Financeiro' }]);
    concludeAiTriage.mockResolvedValue({ id: 'c-1', triageState: 'completed' });
    getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null });
  });

  test.each([0, 0.1, 0.5, 0.79, 0.8, 1])('confiança %s conclui a triagem e nunca gera pergunta', async (confianca) => {
    const contexto = contextoDeTriagemCom({ triagem: { threshold: 0.8, maxQuestions: 5, attempts: 0 } });
    const r = await executeTool('concluir_triagem', { setorId: SETOR, resumo: 'Cliente quer o boleto.', confianca }, contexto);
    expect(r.ok).toBe(true);
    expect(r.resultado.concluido).not.toBe(false);
    expect(r.resultado.motivo).not.toBe('baixa_confianca');
    // Divergência mecânica com o brief: /pergunta/i sobre o resultado inteiro
    // colide com "Não faça mais perguntas." — frase legítima da instrução de
    // sucesso, sem relação com o gate antigo. O alvo real é a pergunta de
    // esclarecimento que baixa_confianca mandava fazer.
    expect(JSON.stringify(r.resultado)).not.toMatch(/pergunta curta de esclarecimento/i);
  });

  // O gate antigo só bloqueava quando t.attempts < t.maxQuestions — com o
  // gate inteiro removido, nenhum estado de attempts pode voltar a bloquear:
  // nem esgotado (attempts === maxQuestions), nem além do limite. attempts:0
  // é o caso em que o gate antigo disparava.
  test.each([0, 1, 4, 5, 6])('confiança baixa (0.1) nunca bloqueia, qualquer que seja attempts (%i)', async (attempts) => {
    const contexto = contextoDeTriagemCom({ triagem: { threshold: 0.8, maxQuestions: 5, attempts } });
    const r = await executeTool('concluir_triagem', { setorId: SETOR, resumo: 'Cliente quer o boleto.', confianca: 0.1 }, contexto);
    expect(r.ok).toBe(true);
    expect(r.resultado.concluido).toBe(true);
    expect(r.resultado.motivo).not.toBe('baixa_confianca');
  });

  test('a confiança baixa continua marcada no resumo do atendente', async () => {
    const contexto = contextoDeTriagemCom({ triagem: { threshold: 0.8, maxQuestions: 5, attempts: 0 } });
    await executeTool('concluir_triagem', { setorId: SETOR, resumo: 'x', confianca: 0.4 }, contexto);
    // O resumo vai no SEGUNDO argumento: concludeAiTriage(conversationId, { ..., summary }).
    expect(concludeAiTriage).toHaveBeenCalledWith(
      expect.any(String),
      // lowConfidence somado à checagem do brief: era a única cobertura direta
      // desse campo, e sumiu junto com o teste apagado que a exercitava.
      expect.objectContaining({ summary: expect.stringContaining('40% (BAIXA)'), lowConfidence: true })
    );
  });
});


describe('encerrar_atendimento', () => {
  const MOTIVO_RESOLVIDO = '33333333-3333-3333-3333-333333333333';
  const ctx = (extra = {}) => ({
    conversationId: 'c-1', channelId: 'ch-1', contact: { id: 'ct-1' },
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João' },
    ferramentasPermitidas: ['encerrar_atendimento'], contracts: [], ...extra,
  });
  const emTriagemComEntrega = { id: 'c-1', status: 'waiting', assignedAgentId: null, triageState: 'pending', aiTriageResolvedByAi: true };

  beforeEach(() => {
    jest.clearAllMocks();
    motivoDeEncerramentoAtivo.mockResolvedValue(MOTIVO_RESOLVIDO);
    getConversationWithContact.mockResolvedValue(emTriagemComEntrega);
    closeConversationByAi.mockResolvedValue({ id: 'c-1', status: 'closed' });
  });

  test('não tem parâmetros obrigatórios e é isenta da checagem de dono', () => {
    const t = findTool('encerrar_atendimento');
    expect(t.categoria).toBe('ACAO');
    expect(t.isentoDeProprietario).toBe(true);
    expect(t.parametros).toEqual({ type: 'object', properties: {} });
    expect(t.validar({})).toEqual({ ok: true, args: {} });
  });

  test('fora do perfil de triagem, recusa sem tocar em nada', async () => {
    const r = await findTool('encerrar_atendimento').executar({}, { conversationId: 'c-1', contracts: [] });
    expect(r).toEqual({ ok: false, erro: 'encerrar_atendimento is only available during AI triage' });
    expect(closeConversationByAi).not.toHaveBeenCalled();
  });

  test('sem motivo configurado pelo admin, não encerra e manda concluir a triagem', async () => {
    motivoDeEncerramentoAtivo.mockResolvedValue(null);
    const r = await findTool('encerrar_atendimento').executar({}, ctx());
    expect(r.encerrado).toBe(false);
    expect(r.motivo).toBe('Encerramento pela IA não está configurado ou o motivo foi desativado. Conclua a triagem com concluir_triagem.');
    expect(closeConversationByAi).not.toHaveBeenCalled();
  });

  // O admin desativar o motivo é o caso que acontece de verdade (apagar o
  // app nem oferece), e é exatamente o que motivoDeEncerramentoAtivo cobre.
  test('motivo desativado depois de configurado não encerra', async () => {
    motivoDeEncerramentoAtivo.mockResolvedValue(null);
    const c = ctx();
    const r = await findTool('encerrar_atendimento').executar({}, c);
    expect(r.encerrado).toBe(false);
    expect(closeConversationByAi).not.toHaveBeenCalled();
    expect(c.atendimentoEncerrado).toBeUndefined();
  });

  test('sem nada entregue nesta conversa, nunca encerra', async () => {
    getConversationWithContact.mockResolvedValue({ ...emTriagemComEntrega, aiTriageResolvedByAi: false });
    const r = await findTool('encerrar_atendimento').executar({}, ctx());
    expect(r.encerrado).toBe(false);
    expect(r.motivo).toMatch(/Nada foi entregue/i);
    expect(closeConversationByAi).not.toHaveBeenCalled();
  });

  test.each([
    ['atendente assumiu', { ...emTriagemComEntrega, assignedAgentId: 'ag-1' }],
    ['conversa fechada', { ...emTriagemComEntrega, status: 'closed' }],
    ['triagem já concluída', { ...emTriagemComEntrega, triageState: 'completed' }],
    ['conversa não encontrada', null],
  ])('%s: não encerra', async (_nome, conversa) => {
    getConversationWithContact.mockResolvedValue(conversa);
    const r = await findTool('encerrar_atendimento').executar({}, ctx());
    expect(r.encerrado).toBe(false);
    expect(closeConversationByAi).not.toHaveBeenCalled();
  });

  // Correção 2026-09-18: a guarda do escopo de terceiro passou a ficar
  // imediatamente antes de closeConversationByAi (a ação terminal), não mais
  // logo após o perfil. Antes desta correção, qualquer um destes três
  // { encerrado: false } já tinha destruído a autorização mesmo sem encerrar
  // nada — a cliente teria que informar de novo o CPF do titular.
  test.each([
    ['sem motivo configurado', () => motivoDeEncerramentoAtivo.mockResolvedValue(null)],
    ['saiu da triagem', () => getConversationWithContact.mockResolvedValue({ ...emTriagemComEntrega, assignedAgentId: 'ag-1' })],
    ['nada entregue', () => getConversationWithContact.mockResolvedValue({ ...emTriagemComEntrega, aiTriageResolvedByAi: false })],
  ])('sai por { encerrado: false } (%s): preserva o escopo de terceiro e não chama setThirdPartyScope', async (_nome, armar) => {
    armar();
    const terceiro = { nome: 'Maria', contratos: [{ id: 77 }] };
    const c = ctx({ terceiro });
    const r = await findTool('encerrar_atendimento').executar({}, c);
    expect(r.encerrado).toBe(false);
    expect(setThirdPartyScope).not.toHaveBeenCalled();
    expect(c.terceiro).toBe(terceiro);
  });

  test('caminho feliz: fecha com o motivo configurado, resume, avisa o painel e marca o turno', async () => {
    const c = ctx({ registroFerramentas: [{ nome: 'gerar_pix', resultado: '{"enviado":true}' }] });
    const r = await findTool('encerrar_atendimento').executar({}, c);

    expect(closeConversationByAi).toHaveBeenCalledWith('c-1', {
      reasonId: MOTIVO_RESOLVIDO,
      summary: 'Resolvido pela IA e encerrado sem atendente.\nFerramentas: gerar_pix → {"enviado":true}',
    });
    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', expect.objectContaining({
      conversation: expect.any(Object), closedAt: expect.any(String),
    }));
    // A conversa nunca esteve visível na fila: não há nada para remover dela.
    expect(broadcast).not.toHaveBeenCalled();
    expect(c.atendimentoEncerrado).toBe(true);
    expect(r.encerrado).toBe(true);
    // Despedida no modelo pedido pelo dono: "Imagina, {nome}! 😊 … Tenha um ótimo dia!"
    expect(r.instrucao).toMatch(/Imagina, \{nome\}/);
    expect(r.instrucao).toMatch(/ótimo dia/);
  });

  test('corrida: se o fechamento não pegar a conversa, não avisa nem marca o turno', async () => {
    closeConversationByAi.mockResolvedValue(null);
    const c = ctx();
    const r = await findTool('encerrar_atendimento').executar({}, c);
    expect(r).toEqual({ encerrado: false, motivo: 'A conversa já saiu da triagem.' });
    expect(broadcastToDashboard).not.toHaveBeenCalled();
    expect(c.atendimentoEncerrado).toBeUndefined();
  });

  describe('modo noturno', () => {
    test('à noite a despedida avisa que a equipe volta na hora de retorno', async () => {
      const c = ctx({ triagem: { threshold: 0.8, maxQuestions: 4, attempts: 0, noturno: { ativo: true, retornoAs: '08:00' } } });
      const r = await findTool('encerrar_atendimento').executar({}, c);
      expect(r.encerrado).toBe(true);
      expect(r.instrucao).toMatch(/a equipe volta às 08:00/);
    });

    test('de dia a despedida segue como hoje', async () => {
      const r = await findTool('encerrar_atendimento').executar({}, ctx());
      expect(r.instrucao).not.toMatch(/a equipe volta às/);
    });
  });
});

// A leitura de comprovante é a única ferramenta que manda um arquivo do
// servidor para fora. Quem escolhe a imagem é o servidor (a última que o
// cliente mandou nas 24 h), o modelo não recebe parâmetro nenhum, e o caminho
// do arquivo nunca volta no resultado nem no contexto.
describe('analisar_comprovante', () => {
  const JANELA_24H = 24 * 60 * 60 * 1000;
  const IMAGEM = { id: 'm-9', mediaPath: 'abc123.png', mediaMimeType: 'image/png', createdAt: new Date() };
  // A conferência de data usa o dia de hoje em São Paulo: fixar uma data no
  // teste faria ele apodrecer em uma semana.
  const hojeEmSaoPaulo = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const ID_TRANSACAO = 'E18236120202609131200abcdef123456';
  const LEITURA = { ehComprovante: true, tipo: 'pix', valor: 135, data: hojeEmSaoPaulo(), favorecido: 'PROVEDOR X LTDA', banco: 'Nubank', confianca: 0.95, idTransacao: ID_TRANSACAO };
  const ctx = (extra = {}) => ({
    conversationId: 'c-1',
    contracts: [{ id: 17402, address: 'RUA X' }],
    identidade: { nivel: 'forte', primeiroNome: 'Ana' },
    triagem: { noturno: { ativo: true, retornoAs: '08:00' } },
    ...extra,
  });
  let stat;
  let readFile;

  beforeEach(() => {
    jest.clearAllMocks();
    findLatestInboundImage.mockResolvedValue(IMAGEM);
    getMediaFilePath.mockReturnValue('/var/midia/abc123.png');
    stat = jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 300 * 1024 });
    readFile = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('IMG'));
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x' });
    analyzeImage.mockResolvedValue({ ...LEITURA });
    sgpClient.getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '4321', value: 135, dueDate: '2026-09-16' }] });
    getCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda'] });
    // Padrão: o comprovante nunca tinha sido usado antes.
    findReceiptUsage.mockResolvedValue(null);
  });

  afterEach(() => {
    stat.mockRestore();
    readFile.mockRestore();
  });

  test('está registrada sem parâmetros, isenta de dono e exigindo identidade forte', () => {
    const t = findTool('analisar_comprovante');
    expect(t.categoria).toBe('CONSULTA');
    expect(t.parametros).toEqual({ type: 'object', properties: {} });
    expect(t.isentoDeProprietario).toBe(true);
    expect(t.exigeIdentidadeForte).toBe(true);
    // Argumento inventado pelo modelo não vira caminho de arquivo nenhum.
    expect(t.validar({ mediaPath: '../../etc/passwd' })).toEqual({ ok: true, args: {} });
  });

  test('(a) fora da triagem: recusa sem tocar em arquivo nenhum', async () => {
    const r = await findTool('analisar_comprovante').executar({}, { conversationId: 'c-1' });
    expect(r.ok).toBe(false);
    expect(findLatestInboundImage).not.toHaveBeenCalled();
  });

  test('(b) de dia com a leitura desligada: não roda', async () => {
    const r = await findTool('analisar_comprovante').executar({}, ctx({ triagem: { noturno: { ativo: false, retornoAs: null } } }));
    expect(r).toEqual({ analisado: false, motivo: 'Leitura de comprovante de dia está desligada.' });
    expect(findLatestInboundImage).not.toHaveBeenCalled();
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  // A flag da triagem (Parte 1) é o que abre a leitura de dia. Sem desbloqueio
  // nenhum: de dia a ferramenta só confere e alimenta o resumo da atendente.
  test('(b2) de dia com a leitura ligada: lê normalmente', async () => {
    getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', triageReadReceiptsDaytime: true });
    const c = ctx({ triagem: { noturno: { ativo: false, retornoAs: null } } });
    const r = await findTool('analisar_comprovante').executar({}, c);
    expect(analyzeImage).toHaveBeenCalled();
    expect(r).toMatchObject({ analisado: true, valido: true, contratoId: 17402, faturaId: '4321' });
    expect(c.comprovante).toMatchObject({ valido: true, idTransacao: ID_TRANSACAO });
  });

  // A descrição da ferramenta é o que o modelo lê: dizer "só no modo noturno"
  // com a leitura de dia ligada é convidá-lo a não chamar a ferramenta.
  test('a descrição não promete modo noturno e proíbe confirmar pagamento', () => {
    const t = findTool('analisar_comprovante');
    expect(t.descricao).not.toMatch(/Só no modo noturno/i);
    expect(t.descricao).toMatch(/Nunca confirma pagamento/);
  });

  test('(c) sem imagem do cliente nas últimas 24 horas', async () => {
    findLatestInboundImage.mockResolvedValue(null);
    const r = await findTool('analisar_comprovante').executar({}, ctx());
    expect(findLatestInboundImage).toHaveBeenCalledWith('c-1', { withinMs: JANELA_24H });
    expect(r).toEqual({ analisado: false, motivo: 'Nenhuma imagem recebida do cliente nas últimas 24 horas.' });
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  test('(d) MIME fora da lista (PDF) não vai para a OpenAI', async () => {
    findLatestInboundImage.mockResolvedValue({ ...IMAGEM, mediaMimeType: 'application/pdf' });
    const r = await findTool('analisar_comprovante').executar({}, ctx());
    expect(r.analisado).toBe(false);
    expect(analyzeImage).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  test('(e) imagem acima de 5 MB não é lida do disco nem enviada', async () => {
    stat.mockResolvedValue({ size: 6 * 1024 * 1024 });
    const r = await findTool('analisar_comprovante').executar({}, ctx());
    expect(r.analisado).toBe(false);
    expect(r.motivo).toMatch(/5 MB/);
    expect(readFile).not.toHaveBeenCalled();
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  test('(f) caminho feliz: manda o buffer com o prompt de visão e devolve o veredito conferido', async () => {
    const c = ctx();
    const r = await findTool('analisar_comprovante').executar({}, c);

    expect(analyzeImage).toHaveBeenCalledWith({
      apiKey: 'sk', model: 'gpt-x', imageBuffer: Buffer.from('IMG'),
      mimeType: 'image/png', prompt: PROMPT_VISAO,
    });
    expect(r).toMatchObject({
      analisado: true, valido: true, tipo: 'pix', valor: 135, data: LEITURA.data,
      favorecidoConfere: true, dataConfere: true, valorConfere: true,
      contratoId: 17402, faturaId: '4321', motivos: [],
    });
    expect(r.idTransacao).toBe(ID_TRANSACAO);
    expect(c.comprovante).toEqual({
      valido: true, contratoId: 17402, faturaId: '4321', valor: 135,
      data: LEITURA.data, tipo: 'pix', idTransacao: ID_TRANSACAO, motivos: [],
      usoAnterior: null,
    });
  });

  test('(f) consulta as faturas de TODOS os contratos: o comprovante pode ser do outro ponto', async () => {
    sgpClient.getDuplicateInvoice.mockImplementation(async (id) => (id === 17403
      ? { hasOpenInvoice: true, duplicates: [{ id: '9999', value: 135, dueDate: '2026-09-18' }] }
      : { hasOpenInvoice: false, duplicates: [] }));
    const c = ctx({ contracts: [{ id: 17402, address: 'RUA X' }, { id: 17403, address: 'RUA Y' }] });

    const r = await findTool('analisar_comprovante').executar({}, c);

    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith(17402);
    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith(17403);
    expect(r.faturaId).toBe('9999');
    expect(r.contratoId).toBe(17403);
  });

  test('um contrato que falha no SGP não derruba a conferência dos outros', async () => {
    sgpClient.getDuplicateInvoice.mockImplementation(async (id) => {
      if (id === 17402) throw new Error('SGP fora do ar');
      return { hasOpenInvoice: true, duplicates: [{ id: '9999', value: 135, dueDate: '2026-09-18' }] };
    });
    const r = await findTool('analisar_comprovante').executar({}, ctx({ contracts: [{ id: 17402 }, { id: 17403 }] }));
    expect(r.analisado).toBe(true);
    expect(r.faturaId).toBe('9999');
  });

  // "Talvez eu esteja sendo roubado e não saiba": toda leitura, dia ou noite,
  // diz se aquele id de transação já foi usado — e em qual contrato.
  describe('uso anterior do mesmo id de transação', () => {
    const USADO_EM = new Date('2026-09-14T02:12:00.000Z');

    // O resultado da ferramenta é serializado para a OpenAI: tudo o que entra
    // nele o modelo lê e pode repetir ao cliente. O contrato do uso anterior é
    // de OUTRA pessoa, então ele fica fora — só o fato "sim, já foi usado"
    // atravessa. A descrição vive no contexto do turno, que nunca vai ao modelo.
    test('comprovante já usado: o modelo recebe o fato, nunca o contrato nem a hora', async () => {
      findReceiptUsage.mockResolvedValue({ contactId: 'ct-9', contractId: 26515, usedAt: USADO_EM });
      const c = ctx();
      const r = await findTool('analisar_comprovante').executar({}, c);

      expect(findReceiptUsage).toHaveBeenCalledWith(ID_TRANSACAO);
      expect(r.jaUtilizado).toBe(true);
      expect(r).not.toHaveProperty('descricao');
      expect(r).not.toHaveProperty('usoAnterior');
      const serializado = JSON.stringify(r);
      expect(serializado).not.toContain('26515');
      expect(serializado).not.toContain('23:12');
      expect(serializado).not.toContain('13/09');

      // A descrição existe — só não no que o modelo lê.
      expect(c.comprovante.usoAnterior).toEqual({
        contractId: 26515, usedAt: USADO_EM,
        descricao: 'já utilizado no contrato 26515 em 13/09 às 23:12',
      });
      // O contato do outro cliente não interessa a ninguém aqui: só contrato
      // e hora vão para o resumo.
      expect(c.comprovante.usoAnterior).not.toHaveProperty('contactId');
    });

    test('comprovante inédito: jaUtilizado falso e usoAnterior nulo no contexto', async () => {
      const c = ctx();
      const r = await findTool('analisar_comprovante').executar({}, c);
      expect(findReceiptUsage).toHaveBeenCalledWith(ID_TRANSACAO);
      expect(r.jaUtilizado).toBe(false);
      expect(r).not.toHaveProperty('descricao');
      expect(r).not.toHaveProperty('usoAnterior');
      expect(c.comprovante.usoAnterior).toBeNull();
    });

    // Sem id não há o que procurar: a consulta nem acontece.
    test('comprovante sem id de transação: nem consulta o uso anterior', async () => {
      analyzeImage.mockResolvedValue({ ...LEITURA, idTransacao: null });
      const c = ctx();
      const r = await findTool('analisar_comprovante').executar({}, c);
      expect(findReceiptUsage).not.toHaveBeenCalled();
      expect(r.jaUtilizado).toBe(false);
      expect(c.comprovante.usoAnterior).toBeNull();
    });

    // Vale de dia também: é justamente de dia que o comprovante reenviado por
    // outra pessoa passava despercebido.
    test('de dia, com a leitura ligada, o aviso sai igual — e igualmente sem contrato', async () => {
      getAiConfig.mockResolvedValue({ apiKey: 'sk', model: 'gpt-x', triageReadReceiptsDaytime: true });
      findReceiptUsage.mockResolvedValue({ contactId: 'ct-9', contractId: 26515, usedAt: USADO_EM });
      const c = ctx({ triagem: { noturno: { ativo: false, retornoAs: null } } });
      const r = await findTool('analisar_comprovante').executar({}, c);
      expect(r.jaUtilizado).toBe(true);
      expect(JSON.stringify(r)).not.toContain('26515');
      expect(c.comprovante.usoAnterior.descricao).toBe('já utilizado no contrato 26515 em 13/09 às 23:12');
    });
  });

  test('o caminho do arquivo nunca aparece no resultado nem no contexto', async () => {
    const c = ctx();
    const r = await findTool('analisar_comprovante').executar({}, c);
    const serializado = JSON.stringify(r) + JSON.stringify(c.comprovante);
    expect(r).not.toHaveProperty('mediaPath');
    expect(serializado).not.toContain('abc123.png');
    expect(serializado).not.toContain('/var/midia');
  });

  test('(g) visão falhou: não inventa veredito e não marca nada no contexto', async () => {
    analyzeImage.mockRejectedValue(new Error('timeout'));
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const c = ctx();
    const r = await findTool('analisar_comprovante').executar({}, c);
    expect(r).toEqual({ analisado: false, motivo: 'Não foi possível ler a imagem agora.' });
    expect(c.comprovante).toBeUndefined();
    erroSpy.mockRestore();
  });

  test('arquivo sumiu do disco: recusa limpa, sem o caminho no resultado', async () => {
    readFile.mockRejectedValue(new Error('ENOENT: no such file /var/midia/abc123.png'));
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await findTool('analisar_comprovante').executar({}, ctx());
    expect(r).toEqual({ analisado: false, motivo: 'Não foi possível abrir a imagem.' });
    expect(analyzeImage).not.toHaveBeenCalled();
    erroSpy.mockRestore();
  });

  // O id é o que permite marcar o comprovante como usado depois: sem ele no
  // contexto, o desbloqueio não teria o que reservar.
  test('comprovante sem id legível chega ao contexto com idTransacao nulo', async () => {
    analyzeImage.mockResolvedValue({ ...LEITURA, idTransacao: null });
    const c = ctx();
    const r = await findTool('analisar_comprovante').executar({}, c);
    expect(r.idTransacao).toBeNull();
    expect(c.comprovante.idTransacao).toBeNull();
  });

  test('comprovante que não confere volta inválido com os motivos, e o contexto registra', async () => {
    analyzeImage.mockResolvedValue({ ...LEITURA, valor: 500, favorecido: 'Loja do Joao' });
    const c = ctx();
    const r = await findTool('analisar_comprovante').executar({}, c);
    expect(r.analisado).toBe(true);
    expect(r.valido).toBe(false);
    expect(r.motivos).toEqual(expect.arrayContaining([
      'favorecido não confere com os nomes cadastrados da empresa', 'valor não corresponde a nenhuma fatura em aberto',
    ]));
    expect(r.contratoId).toBeNull();
    expect(c.comprovante.valido).toBe(false);
  });

  // Sem nenhum nome cadastrado nada pode conferir: a recusa sai ANTES da
  // visão, que é paga por imagem.
  test('sem nenhum nome de favorecido cadastrado, recusa antes de gastar a visão', async () => {
    getCompanyConfig.mockResolvedValue({ id: null, name: '', acceptedPayeeNames: [] });
    const c = ctx();
    const r = await findTool('analisar_comprovante').executar({}, c);
    expect(r).toEqual({ analisado: false, motivo: 'Nenhum nome de favorecido cadastrado em Empresa; não é possível conferir comprovantes.' });
    expect(analyzeImage).not.toHaveBeenCalled();
    expect(c.comprovante).toBeUndefined();
  });
});
