// Regra financeira 0 / 1 / 2+ vencidas, contrato cancelado e confirmação pós-PIX (25/09/2026),
// pelas FERRAMENTAS de verdade (tool-registry + tool-executor), com o SGP, o banco e o envio
// mockados. A classificação pura (testes 1–10) mora em situacao-financeira.test.js; aqui fica o que
// o modelo NÃO consegue burlar chamando a ferramenta: o gate antes da entrega (11–20, 31–36) e a
// conferência do pagamento (21–30). As frases proibidas (37–39) estão em guarda-pagamento.test.js e
// ai-orchestrator.test.js.
//
// Documentos, nomes e ids aqui são SINTÉTICOS.
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
jest.mock('./ai-config.repository');
jest.mock('./triage-close-reason');
jest.mock('../conversations/message.repository');
jest.mock('./openai-client');
jest.mock('../cities/contact-city.service');
jest.mock('../company/company-config.repository');
jest.mock('./receipt-usage.repository');
jest.mock('./billing-delivery.repository');
jest.mock('../city-notices/city-notice.service');
jest.mock('../plans/plan.repository');
jest.mock('../cities/city.repository');

const sgpClient = require('../integrations/sgp-client');
const { findTool } = require('./tool-registry');
const { executeTool } = require('./tool-executor');
const { FERRAMENTAS_TRIAGEM, FERRAMENTAS_TRIAGEM_NOTURNO } = require('./ai-orchestrator');
const { listSectors } = require('../sectors/sector.repository');
const {
  concludeAiTriage, getConversationWithContact, markTriageResolvedByAi, closeConversationByAi,
  setTriageReactivation, getTriageReactivation, reserveTriageNightInvoice, getTriageNightInvoice,
} = require('../conversations/conversation.repository');
const { listTrustUnlocksByContract, recordTrustUnlock } = require('./trust-unlock.repository');
const { claimReceipt, releaseReceipt } = require('./receipt-usage.repository');
const { violacoesDoPagamento } = require('./guarda-pagamento');
const { saveMediaFile } = require('../media/media-storage');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { enviarPix, enviarBoleto } = require('../payments/payment-sender');
const { motivoDeEncerramentoAtivo } = require('./triage-close-reason');
const {
  claimDelivery, markDeliveryEnqueued, releaseDelivery, findLatestEnqueuedDelivery,
} = require('./billing-delivery.repository');
const { hojeEmSaoPaulo } = require('./situacao-financeira');
const { isNightModeActive } = require('./night-mode');

const HOJE = hojeEmSaoPaulo();
function dia(delta) {
  const d = new Date(`${HOJE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Título cru do SGP (central/titulos). Vencida: o SGP troca o vencimento_atualizado pela data de
// hoje — exatamente o que a auditoria achou em produção.
function titulo(id, delta, { pago = false, semDataPagamento = false } = {}) {
  const vencimento = dia(delta);
  return {
    id,
    statusid: pago ? 2 : 1,
    status: pago ? 'Pago' : 'Gerado',
    valor: 99.9,
    valorcorrigido: 99.9,
    vencimento,
    vencimento_atualizado: !pago && delta < 0 ? HOJE : vencimento,
    data_pagamento: pago && !semDataPagamento ? dia(delta) : null,
    gerapix: true,
  };
}
const leitura = (titulos, extra = {}) => ({ faturas: titulos, total: titulos.length, completo: true, motivo: null, ...extra });

// 2ª via como o SGP manda: nas vencidas, a data é a ATUALIZADA (hoje) — ordenar por ela não diz
// qual é a mais antiga.
function segundaVia(...titulos) {
  return {
    hasOpenInvoice: titulos.length > 0,
    duplicates: titulos.map((t) => ({
      id: t.id, dueDate: t.vencimento_atualizado, value: t.valor,
      barCode: `linha-${t.id}`, pixCode: `pix-${t.id}`, boletoLink: `https://sgp.invalid/${t.id}.pdf`,
    })),
  };
}

const SETOR_FIN = '11111111-1111-1111-1111-111111111111';
const SETOR_REAT = '33333333-3333-3333-3333-333333333333';
const SETORES = [
  { id: SETOR_FIN, name: 'Financeiro' },
  { id: SETOR_REAT, name: 'Reativação' },
];

const DIA = { threshold: 0.8, maxQuestions: 2, attempts: 0, noturno: { ativo: false, retornoAs: null } };
const NOITE = { threshold: 0.8, maxQuestions: 4, attempts: 0, noturno: { ativo: true, retornoAs: '08:00' } };

const CONTRATO_A = { id: 100, address: 'RUA A, 1', plan: '500MB', statusCode: 1, openInvoicesCount: 9 };
const CONTRATO_B = { id: 200, address: 'RUA B, 2', plan: '300MB', statusCode: 1, openInvoicesCount: 1 };

function ctx(extra = {}) {
  return {
    perfil: 'triagem',
    conversationId: 'c-fin',
    contact: { id: 'ct-1', sgpDocument: '00000000191' },
    contracts: [CONTRATO_A],
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'Ana', client: { id: 9 } },
    ferramentasPermitidas: FERRAMENTAS_TRIAGEM,
    registroFerramentas: [], sgpCache: {}, terceiro: null,
    triagem: DIA,
    resolvidoPelaIa: false,
    messageId: 'msg-1',
    ...extra,
  };
}
const noite = (extra = {}) => ctx({ triagem: NOITE, ferramentasPermitidas: FERRAMENTAS_TRIAGEM_NOTURNO, ...extra });

// O SGP falso: títulos e 2ª via POR CONTRATO. Contrato sem entrada = leitura que falhou.
let titulosPorContrato;
let viasPorContrato;
let entregas;
// As faturas do fluxo noturno de 2+ gravadas na conversa, POR CONTRATO
// (conversations.ai_triage_night_invoices): a primeira de cada contrato fica, como no banco.
let faturasNoturnas;

beforeEach(() => {
  jest.clearAllMocks();
  titulosPorContrato = {};
  viasPorContrato = {};
  entregas = [];
  sgpClient.listAllInvoices.mockImplementation(async (id) => {
    if (!(id in titulosPorContrato)) throw new Error('sgp fora do ar');
    return titulosPorContrato[id];
  });
  sgpClient.getDuplicateInvoice.mockImplementation(async (id) => viasPorContrato[id] || { hasOpenInvoice: false, duplicates: [] });
  sgpClient.downloadBoletoPdf.mockResolvedValue(Buffer.from('%PDF'));
  saveMediaFile.mockResolvedValue('boleto.pdf');
  enqueueOutboundMessage.mockResolvedValue({ id: 'm-1' });
  enviarPix.mockResolvedValue([{ id: 'm-pix' }]);
  enviarBoleto.mockResolvedValue([{ id: 'm-linha' }]);
  getConversationWithContact.mockResolvedValue({
    id: 'c-fin', assignedAgentId: null, status: 'waiting', triageState: 'pending', aiTriageResolvedByAi: false,
  });
  getTriageReactivation.mockResolvedValue(null);
  setTriageReactivation.mockResolvedValue();
  faturasNoturnas = {};
  reserveTriageNightInvoice.mockImplementation(async (_conversa, { contratoId, faturaId, alvo }) => {
    const chave = String(contratoId);
    if (!faturasNoturnas[chave]) faturasNoturnas[chave] = { faturaId: String(faturaId), alvo };
    return faturasNoturnas[chave].faturaId;
  });
  getTriageNightInvoice.mockImplementation(async (_conversa, contratoId) => {
    const gravada = faturasNoturnas[String(contratoId)];
    return gravada ? gravada.faturaId : null;
  });
  listSectors.mockResolvedValue(SETORES);
  concludeAiTriage.mockResolvedValue({ id: 'c-fin' });
  claimDelivery.mockImplementation(async (p) => {
    const registro = { id: `e-${entregas.length + 1}`, ...p, invoiceId: String(p.invoiceId), enqueuedAt: null };
    entregas.push(registro);
    return { obtido: true, registro };
  });
  markDeliveryEnqueued.mockImplementation(async (id) => {
    const e = entregas.find((x) => x.id === id);
    if (e) e.enqueuedAt = new Date();
  });
  releaseDelivery.mockResolvedValue();
  findLatestEnqueuedDelivery.mockImplementation(async () => {
    const saiu = entregas.filter((e) => e.enqueuedAt);
    return saiu.length ? saiu[saiu.length - 1] : null;
  });
});

/** Nada de cobrança saiu: nem 2ª via pedida ao SGP, nem claim, nem mensagem. */
function nadaSaiu() {
  expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalled();
  expect(claimDelivery).not.toHaveBeenCalled();
  expect(enviarPix).not.toHaveBeenCalled();
  expect(enqueueOutboundMessage).not.toHaveBeenCalled();
}

const ENTREGAS = [
  ['gerar_pix', (r) => r.enviado === true, () => enviarPix.mock.calls[0][0].fatura.id],
  ['enviar_boleto', (r) => r.enviado === true, () => sgpClient.downloadBoletoPdf.mock.calls[0][0]],
];

// ================================================================================================
describe('DIA', () => {
  test('11. 0 vencidas: fluxo normal (a fatura do dia sai como sempre saiu)', async () => {
    const doDia = titulo(1101, 0);
    titulosPorContrato[100] = leitura([titulo(1090, -40, { pago: true }), doDia, titulo(1102, 30)]);
    viasPorContrato[100] = segundaVia(doDia);
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx());
    expect(r.enviado).toBe(true);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(1101);
    expect(setTriageReactivation).not.toHaveBeenCalled();
    expect(markTriageResolvedByAi).toHaveBeenCalledWith('c-fin');
  });

  test.each(ENTREGAS)('12. 1 vencida: %s entrega SÓ ela, nunca a futura que a 2ª via lista primeiro', async (nome, enviou) => {
    const vencida = titulo(1201, -10);
    const futura = titulo(1202, 20);
    titulosPorContrato[100] = leitura([futura, titulo(1190, -40, { pago: true }), vencida]);
    // A 2ª via lista a futura PRIMEIRO, e a vencida com a data de hoje.
    viasPorContrato[100] = segundaVia(futura, vencida);
    const r = await findTool(nome).executar({ contratoId: 100 }, ctx());
    expect(enviou(r)).toBe(true);
    if (nome === 'gerar_pix') expect(enviarPix.mock.calls[0][0].fatura.id).toBe(1201);
    else expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://sgp.invalid/1201.pdf');
    expect(claimDelivery).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: '1201', contractId: 100 }));
    expect(setTriageReactivation).not.toHaveBeenCalled();
  });

  test('12b. 1 vencida: gerar_segunda_via devolve só ela', async () => {
    const vencida = titulo(1251, -3);
    titulosPorContrato[100] = leitura([vencida, titulo(1252, 27)]);
    viasPorContrato[100] = segundaVia(titulo(1252, 27), vencida);
    const r = await findTool('gerar_segunda_via').executar({ contratoId: 100 }, ctx());
    expect(r.temFaturaAberta).toBe(true);
    expect(r.faturas.map((f) => f.faturaId)).toEqual([1251]);
  });

  test('12c. 1 vencida + contratoTitulosAReceber alto: o contador do SGP não é contagem de atraso', async () => {
    // CONTRATO_A traz openInvoicesCount 9 (o carnê inteiro): continua sendo 1 vencida.
    const vencida = titulo(1261, -5);
    titulosPorContrato[100] = leitura([vencida, ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => titulo(1270 + n, n * 30))]);
    viasPorContrato[100] = segundaVia(vencida);
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx());
    expect(r.enviado).toBe(true);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(1261);
  });

  test.each([
    ['13. 2 vencidas', [titulo(1301, -40), titulo(1302, -10)]],
    ['14. 4 vencidas', [titulo(1401, -100), titulo(1402, -70), titulo(1403, -40), titulo(1404, -10)]],
  ])('%s de dia: nenhuma cobrança sai por nenhuma das três ferramentas; vai para a reativação', async (_nome, vencidas) => {
    titulosPorContrato[100] = leitura([...vencidas, titulo(1499, 20)]);
    viasPorContrato[100] = segundaVia(...vencidas);
    for (const nome of ['gerar_pix', 'enviar_boleto', 'gerar_segunda_via']) {
      const r = await findTool(nome).executar({ contratoId: 100 }, ctx());
      expect(r.enviado === true || r.temFaturaAberta === true).toBe(false);
      expect(r.cobrancaBloqueada).toBe('reativacao');
      expect(r.instrucao).toContain(SETOR_REAT);
      expect(r.instrucao).not.toMatch(/\b(Financeiro|Comercial|Reativação)\b/);
    }
    nadaSaiu();
    expect(setTriageReactivation).toHaveBeenCalledWith('c-fin', 'multiplas_vencidas');
    expect(markTriageResolvedByAi).not.toHaveBeenCalled();
  });

  test('14b. o vencimento atualizado para hoje não esconde o atraso: 2 vencidas continuam 2', async () => {
    // As duas vencidas têm vencimento_atualizado = HOJE. Pela data atualizada seriam "do dia".
    titulosPorContrato[100] = leitura([titulo(1451, -35), titulo(1452, -5)]);
    viasPorContrato[100] = segundaVia(titulo(1451, -35), titulo(1452, -5));
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx());
    expect(r.cobrancaBloqueada).toBe('reativacao');
    nadaSaiu();
  });

  test('14c. vencendo hoje, futuras e pagas não contam: 1 vencida entre elas é 1', async () => {
    const vencida = titulo(1461, -1);
    titulosPorContrato[100] = leitura([
      vencida, titulo(1462, 0), titulo(1463, 31), titulo(1464, 61),
      titulo(1465, -60, { pago: true }), titulo(1466, -30, { pago: true }),
    ]);
    viasPorContrato[100] = segundaVia(titulo(1462, 0), vencida);
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx());
    expect(r.enviado).toBe(true);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(1461);
  });

  test('15. cancelado: reativação sem entrega, sem inventar motivo e sem prometer reativar', async () => {
    const cancelado = { ...CONTRATO_A, statusCode: 3 };
    titulosPorContrato[100] = leitura([titulo(1501, -200)]);
    viasPorContrato[100] = segundaVia(titulo(1501, -200));
    for (const nome of ['gerar_pix', 'enviar_boleto', 'gerar_segunda_via']) {
      const r = await findTool(nome).executar({ contratoId: 100 }, ctx({ contracts: [cancelado] }));
      expect(r.cobrancaBloqueada).toBe('reativacao');
      expect(r.instrucao).toContain(SETOR_REAT);
      expect(r.instrucao).toMatch(/não invente motivo/i);
      expect(r.instrucao).toMatch(/não prometa/i);
    }
    nadaSaiu();
    expect(setTriageReactivation).toHaveBeenCalledWith('c-fin', 'contrato_cancelado');
  });

  test('indeterminado: leitura incompleta dos títulos → humano, sem entrega e sem reativação', async () => {
    titulosPorContrato[100] = leitura([titulo(1601, -5)], { completo: false, motivo: 'teto_de_paginas' });
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx());
    expect(r.cobrancaBloqueada).toBe('humano');
    expect(r.instrucao).toMatch(/NÃO houve envio/);
    nadaSaiu();
    expect(setTriageReactivation).not.toHaveBeenCalled();
  });

  test('indeterminado: SGP fora do ar na listagem → humano', async () => {
    const r = await findTool('enviar_boleto').executar({ contratoId: 100 }, ctx());
    expect(r.cobrancaBloqueada).toBe('humano');
    nadaSaiu();
  });

  test('indeterminado: status do contrato fora de 1/3/4 → humano', async () => {
    titulosPorContrato[100] = leitura([titulo(1611, -5)]);
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx({ contracts: [{ ...CONTRATO_A, statusCode: 7 }] }));
    expect(r.cobrancaBloqueada).toBe('humano');
    nadaSaiu();
  });

  test('a 2ª via não traz a fatura autorizada: não improvisa com a que veio', async () => {
    titulosPorContrato[100] = leitura([titulo(1701, -8), titulo(1702, 22)]);
    // Só a futura na 2ª via: entregar "a primeira que vier" seria cobrar a fatura errada.
    viasPorContrato[100] = segundaVia(titulo(1702, 22));
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx());
    expect(r.cobrancaBloqueada).toBe('humano');
    expect(enviarPix).not.toHaveBeenCalled();
    expect(claimDelivery).not.toHaveBeenCalled();
  });
});

// ================================================================================================
describe('NOITE', () => {
  const vencidas4 = () => [titulo(2104, -10), titulo(2102, -70), titulo(2101, -100), titulo(2103, -40)];

  test.each(ENTREGAS)('16. noturno com autoatendimento + 4 vencidas: %s entrega SÓ a mais antiga pela data original', async (nome, enviou, qual) => {
    titulosPorContrato[100] = leitura([...vencidas4(), titulo(2199, 20)]);
    // A 2ª via lista a mais recente primeiro; todas com a data de hoje.
    viasPorContrato[100] = segundaVia(...vencidas4());
    const r = await findTool(nome).executar({ contratoId: 100 }, noite());
    expect(enviou(r)).toBe(true);
    expect(qual()).toBe(nome === 'gerar_pix' ? 2101 : 'https://sgp.invalid/2101.pdf');
    expect(r.reativacaoDepois).toBe(true);
    expect(r.instrucao).not.toMatch(/\b(Financeiro|Comercial|Reativação)\b/);
    expect(setTriageReactivation).toHaveBeenCalledWith('c-fin', 'multiplas_vencidas_noturno');
    // 20: nunca "Resolvido pela IA".
    expect(markTriageResolvedByAi).not.toHaveBeenCalled();
  });

  // 17 e 18 passam pela MESMA conta que o worker faz (isNightModeActive): "noite" é janela E
  // autoatendimento noturno ligado — qualquer outra combinação é o dia conservador.
  const CONFIG = { nightStartTime: '20:00', nightEndTime: '08:00' };
  const CANAL = { aiEnabled: true, aiTriageEnabled: true, aiNightModeEnabled: true };
  const MEIA_NOITE_SP = new Date('2026-09-25T03:00:00Z');
  const MEIO_DIA_SP = new Date('2026-09-25T15:00:00Z');
  const triagemPor = (channel, agora) => {
    const ativo = isNightModeActive({ channel, config: CONFIG, agora });
    return { threshold: 0.8, maxQuestions: 2, attempts: 0, noturno: { ativo, retornoAs: ativo ? '08:00' : null } };
  };

  test('17. na janela noturna mas com o autoatendimento DESLIGADO: regra do dia, nada sai com 2+', async () => {
    titulosPorContrato[100] = leitura(vencidas4());
    viasPorContrato[100] = segundaVia(...vencidas4());
    const triagem = triagemPor({ ...CANAL, aiNightModeEnabled: false }, MEIA_NOITE_SP);
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx({ triagem }));
    expect(r.cobrancaBloqueada).toBe('reativacao');
    nadaSaiu();
  });

  test('18. fora da janela com o autoatendimento ligado: regra do dia', async () => {
    titulosPorContrato[100] = leitura(vencidas4());
    viasPorContrato[100] = segundaVia(...vencidas4());
    const triagem = triagemPor(CANAL, MEIO_DIA_SP);
    const r = await findTool('enviar_boleto').executar({ contratoId: 100 }, ctx({ triagem }));
    expect(r.cobrancaBloqueada).toBe('reativacao');
    nadaSaiu();
  });

  test('16b. a mesma conta, na janela e com o autoatendimento ligado, entrega a mais antiga', async () => {
    titulosPorContrato[100] = leitura(vencidas4());
    viasPorContrato[100] = segundaVia(...vencidas4());
    const triagem = triagemPor(CANAL, MEIA_NOITE_SP);
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, ctx({ triagem }));
    expect(r.enviado).toBe(true);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(2101);
  });

  test('19. empate no vencimento original: o menor id, qualquer que seja a ordem da API', async () => {
    titulosPorContrato[100] = leitura([titulo(2952, -30), titulo(2950, -30), titulo(2951, -30)]);
    viasPorContrato[100] = segundaVia(titulo(2952, -30), titulo(2951, -30), titulo(2950, -30));
    await findTool('gerar_pix').executar({ contratoId: 100 }, noite());
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(2950);
  });

  test('noite com 0 ou 1 vencida: o fluxo de sempre (inclusive "resolvido pela IA")', async () => {
    const vencida = titulo(2201, -4);
    titulosPorContrato[100] = leitura([vencida, titulo(2202, 26)]);
    viasPorContrato[100] = segundaVia(titulo(2202, 26), vencida);
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, noite());
    expect(r.enviado).toBe(true);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(2201);
    expect(r.reativacaoDepois).toBeUndefined();
    expect(markTriageResolvedByAi).toHaveBeenCalledWith('c-fin');
    expect(setTriageReactivation).not.toHaveBeenCalled();
  });

  describe('20. depois da entrega noturna de 2+', () => {
    beforeEach(() => {
      getTriageReactivation.mockResolvedValue('multiplas_vencidas_noturno');
      // Mesmo com a flag antiga de "resolvido" de pé (entrega de outro contrato), a reativação vence.
      getConversationWithContact.mockResolvedValue({
        id: 'c-fin', assignedAgentId: null, status: 'waiting', triageState: 'pending', aiTriageResolvedByAi: true,
      });
      motivoDeEncerramentoAtivo.mockResolvedValue('44444444-4444-4444-4444-444444444444');
    });

    const concluir = (setorId, c = noite()) => findTool('concluir_triagem').executar({
      setorId, motivoId: null, resumo: 'Cliente pediu o PIX de madrugada.', confianca: 0.9, pendenciasObrigatorias: [],
    }, c);

    test('concluir_triagem para outro setor é recusado e aponta o setor de reativação', async () => {
      const r = await concluir(SETOR_FIN);
      expect(r.concluido).toBe(false);
      expect(r.instrucao).toContain(SETOR_REAT);
      expect(concludeAiTriage).not.toHaveBeenCalled();
    });

    test('concluir_triagem para a reativação conclui SEM "Resolvido pela IA"', async () => {
      const r = await concluir(SETOR_REAT, noite({ resolvidoPelaIa: true }));
      expect(r.concluido).toBe(true);
      const dados = concludeAiTriage.mock.calls[0][1];
      expect(dados.sectorId).toBe(SETOR_REAT);
      expect(dados.resolvedByAi).toBe(false);
      expect(dados.summary).not.toMatch(/Resolvido pela IA/);
      expect(dados.summary).toMatch(/reativação/i);
      expect(dados.summary).toMatch(/mais antiga/);
    });

    test('encerrar_atendimento é recusado: a conversa não fecha como resolvida', async () => {
      const r = await findTool('encerrar_atendimento').executar({}, noite({ resolvidoPelaIa: true }));
      expect(r.encerrado).toBe(false);
      expect(closeConversationByAi).not.toHaveBeenCalled();
    });

    test('a marca vale no MESMO turno, antes de o banco responder (contexto)', async () => {
      getTriageReactivation.mockResolvedValue(null);
      const r = await concluir(SETOR_FIN, noite({ reativacao: 'multiplas_vencidas_noturno' }));
      expect(r.concluido).toBe(false);
    });
  });

  test('sem setor de reativação cadastrado: a conclusão segue no setor escolhido, ainda sem "Resolvido pela IA"', async () => {
    listSectors.mockResolvedValue([{ id: SETOR_FIN, name: 'Financeiro' }]);
    getTriageReactivation.mockResolvedValue('multiplas_vencidas');
    const r = await findTool('concluir_triagem').executar({
      setorId: SETOR_FIN, motivoId: null, resumo: 'Duas vencidas.', confianca: 0.9, pendenciasObrigatorias: [],
    }, ctx({ resolvidoPelaIa: true }));
    expect(r.concluido).toBe(true);
    expect(concludeAiTriage.mock.calls[0][1].resolvedByAi).toBe(false);
  });
});

// ================================================================================================
describe('PAGAMENTO — conferir_pagamento relê o MESMO título no SGP', () => {
  const PIX_ENVIADO = { id: 'e-9', conversationId: 'c-fin', tool: 'gerar_pix', contractId: 100, invoiceId: '3001', enqueuedAt: new Date() };
  const conferir = (c = ctx()) => findTool('conferir_pagamento').executar({}, c);

  beforeEach(() => {
    findLatestEnqueuedDelivery.mockResolvedValue(PIX_ENVIADO);
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9 }, contracts: [{ ...CONTRATO_A, statusCode: 1 }] });
  });

  test('é uma CONSULTA, está na triagem de dia e de noite, e não recebe argumento do modelo', () => {
    const tool = findTool('conferir_pagamento');
    expect(tool.categoria).toBe('CONSULTA');
    expect(tool.isentoDeProprietario).toBe(true);
    expect(FERRAMENTAS_TRIAGEM).toContain('conferir_pagamento');
    expect(FERRAMENTAS_TRIAGEM_NOTURNO).toContain('conferir_pagamento');
  });

  test('21. cliente diz "paguei" e o título continua Gerado: NÃO confirma', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5)]);
    const c = ctx({ ultimaFala: 'paguei agora pelo pix' });
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(false);
    expect(r.instrucao).toMatch(/ainda não consta como confirmado/i);
    expect(c.pagamentoConfirmado).not.toBe(true);
  });

  test('22. comprovante conferido pela visão e o título continua Gerado: NÃO confirma', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5)]);
    const c = ctx({ comprovante: { valido: true, faturaId: 3001, contratoId: 100, valor: 99.9 } });
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(false);
    expect(c.pagamentoConfirmado).not.toBe(true);
  });

  test('23. o MESMO invoice_id volta Pago + data_pagamento: confirma', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5, { pago: true })]);
    const c = ctx();
    const r = await conferir(c);
    expect(sgpClient.listAllInvoices).toHaveBeenCalledWith(100);
    expect(r.pagamentoConfirmado).toBe(true);
    expect(c.pagamentoConfirmado).toBe(true);
  });

  test('24. OUTRO título pago não confirma o que foi enviado', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5), titulo(3000, -35, { pago: true })]);
    const c = ctx();
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(false);
    expect(c.pagamentoConfirmado).not.toBe(true);
  });

  test('25. Pago sem data_pagamento não basta', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5, { pago: true, semDataPagamento: true })]);
    const r = await conferir();
    expect(r.pagamentoConfirmado).toBe(false);
  });

  test('o título SUMIR da listagem não confirma nada', async () => {
    titulosPorContrato[100] = leitura([titulo(3002, 25)]);
    const r = await conferir();
    expect(r.pagamentoConfirmado).toBe(false);
  });

  test('nenhuma cobrança enviada nesta conversa: não há o que conferir', async () => {
    findLatestEnqueuedDelivery.mockResolvedValue(null);
    const c = ctx();
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(false);
    expect(sgpClient.listAllInvoices).not.toHaveBeenCalled();
  });

  test('26. confirmado: reconta pelo vencimento ORIGINAL na leitura nova — 0 restantes e contrato relido ativo', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5, { pago: true }), titulo(3003, 25)]);
    const c = ctx();
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(true);
    expect(r.faturasVencidasRestantes).toBe(0);
    expect(setTriageReactivation).not.toHaveBeenCalled();
  });

  test('27. 4 vencidas → paga 1 → restam 3: não regularizado, reativação', async () => {
    titulosPorContrato[100] = leitura([
      titulo(3001, -100, { pago: true }), titulo(3002, -70), titulo(3003, -40), titulo(3004, -10),
    ]);
    // Com três vencidas o contrato continua suspenso na releitura.
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9 }, contracts: [{ ...CONTRATO_A, statusCode: 4 }] });
    const c = noite();
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(true);
    expect(r.faturasVencidasRestantes).toBe(3);
    expect(r.regularizado).toBe(false);
    expect(r.instrucao).toContain(SETOR_REAT);
    expect(r.instrucao).toMatch(/não diga que (está|ficou) (tudo )?regularizado/i);
    expect(r.instrucao).toMatch(/NÃO diga que a internet foi liberada/);
    expect(setTriageReactivation).toHaveBeenCalledWith('c-fin', 'multiplas_vencidas');
    expect(c.contratoAtivoConfirmado).not.toBe(true);
    // Pago ou não, 2+ nunca vira "resolvido".
    expect(markTriageResolvedByAi).not.toHaveBeenCalled();
  });

  test('28. confirmado mas o contrato relido continua suspenso: não autoriza dizer "liberada"', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5, { pago: true })]);
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9 }, contracts: [{ ...CONTRATO_A, statusCode: 4 }] });
    const c = ctx({ contracts: [{ ...CONTRATO_A, statusCode: 4 }] });
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(true);
    expect(r.contratoAtivo).toBe(false);
    expect(r.instrucao).toMatch(/NÃO diga que a internet (foi|está) liberada/);
    expect(c.contratoAtivoConfirmado).not.toBe(true);
  });

  test('29. confirmado e o contrato RELIDO está ativo: pode dizer liberado/ativo, mas não "conectado"', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5, { pago: true })]);
    // No início do turno estava suspenso; a releitura é que manda.
    const c = ctx({ contracts: [{ ...CONTRATO_A, statusCode: 4 }] });
    const r = await conferir(c);
    expect(sgpClient.lookupClientByCpf).toHaveBeenCalledWith('00000000191');
    expect(r.contratoAtivo).toBe(true);
    expect(c.contratoAtivoConfirmado).toBe(true);
    expect(r.instrucao).toMatch(/não diga que (ela |a internet )?está (conectada|online)/i);
  });

  test('29b. a releitura do contrato falha: sem fato de liberação', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5, { pago: true })]);
    sgpClient.lookupClientByCpf.mockRejectedValue(new Error('sgp fora do ar'));
    const c = ctx();
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(true);
    expect(r.contratoAtivo).toBe(null);
    expect(c.contratoAtivoConfirmado).not.toBe(true);
  });

  test('leitura incompleta: não confirma e manda para humano', async () => {
    titulosPorContrato[100] = leitura([titulo(3001, -5, { pago: true })], { completo: false, motivo: 'total_ausente' });
    const c = ctx();
    const r = await conferir(c);
    expect(r.pagamentoConfirmado).toBe(false);
    expect(c.pagamentoConfirmado).not.toBe(true);
  });

  test('a cobrança enviada é de um contrato fora deste atendimento (escopo de terceiro expirou): não confere', async () => {
    findLatestEnqueuedDelivery.mockResolvedValue({ ...PIX_ENVIADO, contractId: 999 });
    const r = await conferir();
    expect(r.pagamentoConfirmado).toBe(false);
    expect(sgpClient.listAllInvoices).not.toHaveBeenCalled();
  });
});

// ================================================================================================
describe('MÚLTIPLOS CONTRATOS', () => {
  const doisContratos = (extra = {}) => ctx({ contracts: [CONTRATO_A, CONTRATO_B], ...extra });

  test('31. A = 2 vencidas, B = 0: pedido em A vai para reativação e NÃO troca para B', async () => {
    titulosPorContrato[100] = leitura([titulo(3101, -40), titulo(3102, -10)]);
    titulosPorContrato[200] = leitura([titulo(3201, 15)]);
    viasPorContrato[100] = segundaVia(titulo(3101, -40), titulo(3102, -10));
    viasPorContrato[200] = segundaVia(titulo(3201, 15));
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, doisContratos());
    expect(r.cobrancaBloqueada).toBe('reativacao');
    expect(sgpClient.listAllInvoices).not.toHaveBeenCalledWith(200);
    nadaSaiu();
  });

  test('31b. A sem fatura na 2ª via e B com 2+: a troca automática para B passa pelo gate de B', async () => {
    titulosPorContrato[100] = leitura([titulo(3111, -60, { pago: true })]);
    titulosPorContrato[200] = leitura([titulo(3211, -40), titulo(3212, -10)]);
    viasPorContrato[200] = segundaVia(titulo(3211, -40), titulo(3212, -10));
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, doisContratos());
    expect(r.cobrancaBloqueada).toBe('reativacao');
    expect(enviarPix).not.toHaveBeenCalled();
    expect(claimDelivery).not.toHaveBeenCalled();
  });

  test('32. A = 2, B = 1: B tem a única fatura tratada quando B é o alvo; A continua reativação', async () => {
    titulosPorContrato[100] = leitura([titulo(3121, -40), titulo(3122, -10)]);
    titulosPorContrato[200] = leitura([titulo(3221, -6), titulo(3222, 24)]);
    viasPorContrato[100] = segundaVia(titulo(3121, -40), titulo(3122, -10));
    viasPorContrato[200] = segundaVia(titulo(3222, 24), titulo(3221, -6));
    const c = doisContratos();
    const emA = await findTool('gerar_pix').executar({ contratoId: 100 }, c);
    expect(emA.cobrancaBloqueada).toBe('reativacao');
    const emB = await findTool('gerar_pix').executar({ contratoId: 200 }, c);
    expect(emB.enviado).toBe(true);
    expect(enviarPix).toHaveBeenCalledTimes(1);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(3221);
    expect(claimDelivery).toHaveBeenCalledWith(expect.objectContaining({ contractId: 200, invoiceId: '3221' }));
    // A decisão de A não foi usada para B, e B não apagou a de A.
    expect(setTriageReactivation).toHaveBeenCalledWith('c-fin', 'multiplas_vencidas');
    expect(c.reativacao).toBe('multiplas_vencidas');
  });

  test('33. a 2ª via de A devolve a fatura de B: bloqueia (só o invoice_id autorizado DE A pode sair)', async () => {
    titulosPorContrato[100] = leitura([titulo(3131, -9)]);
    titulosPorContrato[200] = leitura([titulo(3231, -9)]);
    viasPorContrato[100] = segundaVia(titulo(3231, -9));
    const r = await findTool('enviar_boleto').executar({ contratoId: 100 }, doisContratos());
    expect(r.cobrancaBloqueada).toBe('humano');
    expect(sgpClient.downloadBoletoPdf).not.toHaveBeenCalled();
    expect(claimDelivery).not.toHaveBeenCalled();
  });
});

// ================================================================================================
describe('TERCEIRO (pelo executor de verdade: alvo financeiro, posse e minimização)', () => {
  // Fulana (quem fala) tem o contrato 100; Beltrana (terceiro confirmado) tem o 300.
  const BELTRANA = { nome: 'Beltrana', contratos: [{ id: 300 }] };
  const fulana = (extra = {}) => ctx({ terceiro: BELTRANA, ...extra });

  test('34. Fulana pede a cobrança da Beltrana com 1 vencida: só a da Beltrana sai', async () => {
    titulosPorContrato[100] = leitura([titulo(3401, -5)]);
    titulosPorContrato[300] = leitura([titulo(3431, -5), titulo(3432, 25)]);
    viasPorContrato[100] = segundaVia(titulo(3401, -5));
    viasPorContrato[300] = segundaVia(titulo(3432, 25), titulo(3431, -5));
    const r = await executeTool('gerar_pix', {}, fulana());
    expect(r.ok).toBe(true);
    expect(r.resultado.enviado).toBe(true);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(3431);
    expect(sgpClient.listAllInvoices).not.toHaveBeenCalledWith(100);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(100);
  });

  test('35. Beltrana com 2+ de dia: reativação, e a cobrança da Fulana NUNCA vira fallback', async () => {
    titulosPorContrato[100] = leitura([titulo(3501, -5)]);
    titulosPorContrato[300] = leitura([titulo(3531, -40), titulo(3532, -10)]);
    viasPorContrato[100] = segundaVia(titulo(3501, -5));
    viasPorContrato[300] = segundaVia(titulo(3531, -40), titulo(3532, -10));
    const r = await executeTool('gerar_pix', {}, fulana());
    expect(r.ok).toBe(true);
    expect(r.resultado.enviado).toBe(false);
    expect(r.resultado.instrucao).toContain(SETOR_REAT);
    expect(sgpClient.listAllInvoices).not.toHaveBeenCalledWith(100);
    nadaSaiu();
  });

  test('35b. o gate vale para o terceiro no boleto também, sem tocar o contrato de quem fala', async () => {
    titulosPorContrato[300] = leitura([titulo(3541, -40), titulo(3542, -10)]);
    const r = await executeTool('enviar_boleto', {}, fulana());
    expect(r.resultado.enviado).toBe(false);
    expect(sgpClient.listAllInvoices).toHaveBeenCalledWith(300);
    expect(sgpClient.listAllInvoices).not.toHaveBeenCalledWith(100);
    nadaSaiu();
  });

  test('36. terceiro não encontrado (pendente): o comportamento grudento continua — nada da Fulana sai', async () => {
    titulosPorContrato[100] = leitura([titulo(3601, -5)]);
    viasPorContrato[100] = segundaVia(titulo(3601, -5));
    const pendente = { nome: null, contratos: [], pendente: true };
    const semContrato = await executeTool('gerar_pix', {}, fulana({ terceiro: pendente }));
    expect(semContrato.ok).toBe(false);
    const comContratoDaFulana = await executeTool('gerar_pix', { contratoId: 100 }, fulana({ terceiro: pendente }));
    expect(comContratoDaFulana.ok).toBe(false);
    expect(comContratoDaFulana.motivo).toBe('financial_target_mismatch');
    expect(sgpClient.listAllInvoices).not.toHaveBeenCalled();
    nadaSaiu();
  });
});

// ================================================================================================
describe('consultar_faturas_todos_contratos: vencidas contadas pela data ORIGINAL, contrato a contrato', () => {
  const consultar = (c) => findTool('consultar_faturas_todos_contratos').executar({}, c);
  const doisContratos = () => ctx({ contracts: [CONTRATO_A, CONTRATO_B] });

  test('cada contrato traz a PRÓPRIA contagem; fatura do dia, carnê futuro e pagas não contam', async () => {
    sgpClient.listInvoices.mockImplementation(async (id) => (id === 100
      ? { faturas: [titulo(4001, -40), titulo(4002, -10), titulo(4003, 0), titulo(4004, 30), titulo(4005, 60)], paginacao: { total: 5 } }
      : { faturas: [titulo(4101, 20), titulo(4102, -60, { pago: true })], paginacao: { total: 2 } }));
    const r = await consultar(doisContratos());
    expect(r.contratos.find((c) => c.contratoId === 100).faturasVencidas).toBe(2);
    expect(r.contratos.find((c) => c.contratoId === 200).faturasVencidas).toBe(0);
  });

  test('lista parcial ou sem total: a contagem não é afirmada (null)', async () => {
    sgpClient.listInvoices.mockImplementation(async (id) => (id === 100
      ? { faturas: [titulo(4201, -40)], paginacao: { total: 60 } }
      : { faturas: [titulo(4301, -5)], paginacao: {} }));
    const r = await consultar(doisContratos());
    expect(r.contratos.find((c) => c.contratoId === 100).faturasVencidas).toBeNull();
    expect(r.contratos.find((c) => c.contratoId === 200).faturasVencidas).toBeNull();
  });

  test('contrato cancelado: sem contagem, marcado como cancelado', async () => {
    sgpClient.listInvoices.mockResolvedValue({ faturas: [titulo(4401, -300)], paginacao: { total: 1 } });
    const r = await consultar(ctx({ contracts: [{ ...CONTRATO_A, statusCode: 3 }] }));
    expect(r.contratos[0].faturasVencidas).toBeNull();
    expect(r.contratos[0].contratoCancelado).toBe(true);
  });
});

describe('conexão verificada é o único fato para "está online"', () => {
  test('consultar_status_conexao online marca o turno; offline não', async () => {
    sgpClient.checkConnection.mockResolvedValueOnce({ status: 1 });
    const online = ctx();
    await findTool('consultar_status_conexao').executar({ contratoId: 100 }, online);
    expect(online.conexaoOnline).toBe(true);

    sgpClient.checkConnection.mockResolvedValueOnce({ status: 2 });
    const offline = ctx();
    await findTool('consultar_status_conexao').executar({ contratoId: 100 }, offline);
    expect(offline.conexaoOnline).not.toBe(true);
  });
});

// ================================================================================================
// Ajuste de 25/09/2026 — o fluxo noturno que COMEÇOU com 2+ trata só a fatura vencida mais antiga
// escolhida nele. Depois disso nenhuma OUTRA fatura sai automaticamente nesta conversa — nem com a
// primeira paga, nem com a contagem caindo para 1 — e a conversa continua na reativação. O reenvio
// da MESMA cobrança segue a idempotência de sempre.
describe('fluxo noturno que começou com 2+: nenhuma segunda fatura na mesma conversa', () => {
  let motivoGravado;
  beforeEach(() => {
    motivoGravado = null;
    setTriageReactivation.mockImplementation(async (_c, motivo) => { if (!motivoGravado) motivoGravado = motivo; });
    getTriageReactivation.mockImplementation(async () => motivoGravado);
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9 }, contracts: [{ ...CONTRATO_A, statusCode: 4 }] });
    // As DUAS restrições de ai_billing_deliveries: uma entrega por mensagem, e um envio inicial só.
    claimDelivery.mockImplementation(async (p) => {
      const mesmaMensagem = entregas.find((e) => e.tool === p.tool && e.contractId === p.contractId
        && e.invoiceId === String(p.invoiceId) && e.messageId === String(p.messageId));
      if (mesmaMensagem) return { obtido: false, registro: mesmaMensagem };
      if (p.isResend !== true) {
        const inicial = entregas.find((e) => e.tool === p.tool && e.contractId === p.contractId
          && e.invoiceId === String(p.invoiceId) && !e.isResend);
        if (inicial) return { obtido: false, registro: inicial };
      }
      const registro = {
        id: `e-${entregas.length + 1}`, ...p, invoiceId: String(p.invoiceId), messageId: String(p.messageId),
        isResend: p.isResend === true, enqueuedAt: null,
      };
      entregas.push(registro);
      return { obtido: true, registro };
    });
  });
  // Cada turno é um contexto NOVO: nada vem da memória do turno anterior, só do banco.
  const turnoNoite = (n, extra = {}) => noite({ messageId: `msg-${n}`, ...extra });
  const turnoDia = (n, extra = {}) => ctx({ messageId: `msg-${n}`, ...extra });

  test('1 (e A). contrato A com 2 vencidas à noite → entrega A1 → paga → sobra A2 → A2 NÃO sai; segue reativação', async () => {
    const X = titulo(5101, -40);
    const Y = titulo(5102, -10);
    titulosPorContrato[100] = leitura([Y, X]);
    viasPorContrato[100] = segundaVia(Y, X);
    const primeira = await findTool('gerar_pix').executar({ contratoId: 100 }, turnoNoite(1));
    expect(primeira.enviado).toBe(true);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(5101);
    // A reserva é do CONTRATO A, com o alvo financeiro dele.
    expect(reserveTriageNightInvoice).toHaveBeenCalledWith('c-fin', { contratoId: 100, faturaId: '5101', alvo: 'principal' });
    expect(faturasNoturnas).toEqual({ 100: { faturaId: '5101', alvo: 'principal' } });

    // A mais antiga foi paga: sobra só a Y.
    titulosPorContrato[100] = leitura([titulo(5101, -40, { pago: true }), Y]);
    viasPorContrato[100] = segundaVia(Y);
    const conferido = await findTool('conferir_pagamento').executar({}, turnoNoite(2));
    expect(conferido.pagamentoConfirmado).toBe(true);
    expect(conferido.faturasVencidasRestantes).toBe(1);
    expect(conferido.instrucao).toContain(SETOR_REAT);
    expect(conferido.instrucao).not.toMatch(/pode ser enviada/);

    // Pela regra de 1 vencida ela sairia; no fluxo que começou com 2+ à noite, não — de noite
    // ou de dia, por nenhuma das três ferramentas.
    for (const [nome, c] of [['gerar_pix', turnoNoite(3)], ['enviar_boleto', turnoDia(4)], ['gerar_segunda_via', turnoDia(5)]]) {
      const r = await findTool(nome).executar({ contratoId: 100 }, c);
      expect(r.cobrancaBloqueada).toBe('reativacao');
      expect(r.instrucao).toContain(SETOR_REAT);
      expect(r.instrucao).not.toMatch(/\b(Financeiro|Comercial|Reativação)\b/);
    }
    expect(enviarPix).toHaveBeenCalledTimes(1);
    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledTimes(1);
    expect(sgpClient.downloadBoletoPdf).not.toHaveBeenCalled();
    expect(markTriageResolvedByAi).not.toHaveBeenCalled();
    expect(motivoGravado).toBe('multiplas_vencidas_noturno');
    expect(faturasNoturnas).toEqual({ 100: { faturaId: '5101', alvo: 'principal' } });
  });

  test('B. 4 vencidas → paga a mais antiga → restam 3 → a nova mais antiga NÃO sai', async () => {
    const quatro = [titulo(5201, -100), titulo(5202, -70), titulo(5203, -40), titulo(5204, -10)];
    titulosPorContrato[100] = leitura(quatro);
    viasPorContrato[100] = segundaVia(...quatro);
    expect((await findTool('gerar_pix').executar({ contratoId: 100 }, turnoNoite(1))).enviado).toBe(true);
    titulosPorContrato[100] = leitura([titulo(5201, -100, { pago: true }), ...quatro.slice(1)]);
    viasPorContrato[100] = segundaVia(...quatro.slice(1));
    const r = await findTool('gerar_pix').executar({ contratoId: 100 }, turnoNoite(2));
    expect(r.cobrancaBloqueada).toBe('reativacao');
    expect(enviarPix).toHaveBeenCalledTimes(1);
    expect(enviarPix.mock.calls[0][0].fatura.id).toBe(5201);
    expect(markTriageResolvedByAi).not.toHaveBeenCalled();
  });

  test('5 (e C). reenvio da MESMA fatura A1: passa pelo gate e a idempotência de sempre decide', async () => {
    const X = titulo(5301, -40);
    const Y = titulo(5302, -10);
    titulosPorContrato[100] = leitura([X, Y]);
    viasPorContrato[100] = segundaVia(Y, X);
    expect((await findTool('gerar_pix').executar({ contratoId: 100 }, turnoNoite(1))).enviado).toBe(true);
    // Mesma mensagem de novo: a restrição 1 segura.
    const mesmaMensagem = await findTool('gerar_pix').executar({ contratoId: 100 }, turnoNoite(1));
    expect(mesmaMensagem.jaEnviado).toBe(true);
    // Mensagem nova sem pedido de reenvio: o envio inicial segura.
    const semReenvio = await findTool('gerar_pix').executar({ contratoId: 100 }, turnoNoite(2));
    expect(semReenvio.jaEnviado).toBe(true);
    expect(semReenvio.cobrancaBloqueada).toBeUndefined();
    // Mensagem nova COM pedido de reenvio: sai de novo — e é a MESMA fatura.
    const reenvio = await findTool('gerar_pix').executar({ contratoId: 100, reenviar: true }, turnoNoite(3));
    expect(reenvio.enviado).toBe(true);
    expect(enviarPix).toHaveBeenCalledTimes(2);
    expect(enviarPix.mock.calls.map((c) => c[0].fatura.id)).toEqual([5301, 5301]);
    // O boleto da MESMA fatura também pode sair (outra ferramenta, a cobrança autorizada é a mesma).
    const boleto = await findTool('enviar_boleto').executar({ contratoId: 100 }, turnoNoite(4));
    expect(boleto.enviado).toBe(true);
    expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://sgp.invalid/5301.pdf');
  });

  // Ajuste final de 25/09/2026: a trava é do CONTRATO que entrou no fluxo (com o alvo financeiro
  // dele), não da conversa. Cada contrato é analisado separadamente: o fluxo noturno de A não
  // bloqueia B quando o cliente pede B explicitamente — e nenhum dos dois serve de reserva do outro.
  describe('a trava é do contrato, não da conversa', () => {
    const dois = (n, extra = {}) => turnoNoite(n, { contracts: [CONTRATO_A, CONTRATO_B], ...extra });
    /** A com 2 vencidas à noite: A1 (a mais antiga) sai e fica reservada para A. */
    async function contratoANoFluxoNoturno() {
      titulosPorContrato[100] = leitura([titulo(5401, -40), titulo(5402, -10)]);
      viasPorContrato[100] = segundaVia(titulo(5402, -10), titulo(5401, -40));
      const r = await findTool('gerar_pix').executar({ contratoId: 100 }, dois(1));
      expect(r.enviado).toBe(true);
      expect(enviarPix.mock.calls[0][0].fatura.id).toBe(5401);
    }

    test('2. depois de A1, o cliente pede o contrato B (1 vencida): B1 sai, e só ela', async () => {
      await contratoANoFluxoNoturno();
      titulosPorContrato[200] = leitura([titulo(5501, -6), titulo(5502, 24)]);
      viasPorContrato[200] = segundaVia(titulo(5502, 24), titulo(5501, -6));
      const emB = await findTool('gerar_pix').executar({ contratoId: 200 }, dois(2));
      expect(emB.enviado).toBe(true);
      expect(enviarPix).toHaveBeenCalledTimes(2);
      expect(enviarPix.mock.calls[1][0].fatura.id).toBe(5501);
      expect(claimDelivery).toHaveBeenLastCalledWith(expect.objectContaining({ contractId: 200, invoiceId: '5501' }));
      // B seguiu a regra de 1 vencida: nada foi reservado para B.
      expect(reserveTriageNightInvoice).not.toHaveBeenCalledWith('c-fin', expect.objectContaining({ contratoId: 200 }));
    });

    test('3. tratar B não apaga a reativação de A: A2 continua bloqueada, a conversa segue na reativação', async () => {
      await contratoANoFluxoNoturno();
      titulosPorContrato[200] = leitura([titulo(5601, -6)]);
      viasPorContrato[200] = segundaVia(titulo(5601, -6));
      expect((await findTool('gerar_pix').executar({ contratoId: 200 }, dois(2))).enviado).toBe(true);
      // A1 paga depois; sobra A2 — que continua sem sair.
      titulosPorContrato[100] = leitura([titulo(5401, -40, { pago: true }), titulo(5402, -10)]);
      viasPorContrato[100] = segundaVia(titulo(5402, -10));
      const a2 = await findTool('gerar_pix').executar({ contratoId: 100 }, dois(3));
      expect(a2.cobrancaBloqueada).toBe('reativacao');
      expect(motivoGravado).toBe('multiplas_vencidas_noturno');
      expect(faturasNoturnas).toEqual({ 100: { faturaId: '5401', alvo: 'principal' } });
      expect(markTriageResolvedByAi).not.toHaveBeenCalled();
      const concluir = (setorId) => findTool('concluir_triagem').executar({
        setorId, motivoId: null, resumo: 'PIX de A (mais antiga) e de B.', confianca: 0.9, pendenciasObrigatorias: [],
      }, dois(4));
      expect((await concluir(SETOR_FIN)).concluido).toBe(false);
      expect((await concluir(SETOR_REAT)).concluido).toBe(true);
      expect(concludeAiTriage.mock.calls[0][1].resolvedByAi).toBe(false);
    });

    test('4a. troca silenciosa B → A: B sem fatura não cai na fatura de A (A não é reserva de B)', async () => {
      await contratoANoFluxoNoturno();
      // B sem nada em aberto: a troca automática antiga acharia a fatura de A.
      titulosPorContrato[200] = leitura([titulo(5701, -30, { pago: true })]);
      const emB = await findTool('gerar_pix').executar({ contratoId: 200 }, dois(2));
      expect(emB.enviado).not.toBe(true);
      expect(emB.cobrancaBloqueada).toBe('reativacao');
      expect(enviarPix).toHaveBeenCalledTimes(1);
      expect(claimDelivery).toHaveBeenCalledTimes(1);
    });

    test('4b. troca silenciosa A → B: o pedido em A bloqueado nunca vira a fatura de B (B não é reserva de A)', async () => {
      await contratoANoFluxoNoturno();
      titulosPorContrato[100] = leitura([titulo(5401, -40, { pago: true }), titulo(5402, -10)]);
      viasPorContrato[100] = segundaVia(titulo(5402, -10));
      titulosPorContrato[200] = leitura([titulo(5801, -6)]);
      viasPorContrato[200] = segundaVia(titulo(5801, -6));
      const emA = await findTool('gerar_pix').executar({ contratoId: 100 }, dois(2));
      expect(emA.cobrancaBloqueada).toBe('reativacao');
      expect(sgpClient.listAllInvoices).not.toHaveBeenCalledWith(200);
      expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalledWith(200);
      expect(enviarPix).toHaveBeenCalledTimes(1);
    });

    test('A e B em fluxos noturnos PRÓPRIOS, no mesmo turno: cada um só a sua mais antiga, cada um com a sua reserva', async () => {
      titulosPorContrato[100] = leitura([titulo(5901, -40), titulo(5902, -10)]);
      viasPorContrato[100] = segundaVia(titulo(5902, -10), titulo(5901, -40));
      titulosPorContrato[200] = leitura([titulo(5951, -50), titulo(5952, -20)]);
      viasPorContrato[200] = segundaVia(titulo(5952, -20), titulo(5951, -50));
      const c = dois(1);
      const [a, b] = await Promise.all([
        findTool('gerar_pix').executar({ contratoId: 100 }, c),
        findTool('gerar_pix').executar({ contratoId: 200 }, c),
      ]);
      expect(a.enviado).toBe(true);
      expect(b.enviado).toBe(true);
      expect(enviarPix.mock.calls.map((x) => x[0].fatura.id).sort()).toEqual([5901, 5951]);
      expect(faturasNoturnas).toEqual({
        100: { faturaId: '5901', alvo: 'principal' },
        200: { faturaId: '5951', alvo: 'principal' },
      });
    });
  });

  // O alvo financeiro (terceiro grudento, Fulana/Beltrana) continua decidindo QUAL contrato pode ser
  // cobrado: a trava por contrato roda depois dele, pelo executor de verdade.
  describe('4c. troca silenciosa de alvo financeiro (pelo executor de verdade)', () => {
    const BELTRANA = { nome: 'Beltrana', contratos: [{ id: 300 }] };

    test('Beltrana no fluxo noturno de 2+; sem mudar o alvo, a cobrança da Fulana é recusada; com o alvo trocado, segue a regra dela', async () => {
      titulosPorContrato[300] = leitura([titulo(6001, -40), titulo(6002, -10)]);
      viasPorContrato[300] = segundaVia(titulo(6002, -10), titulo(6001, -40));
      titulosPorContrato[100] = leitura([titulo(6101, -6)]);
      viasPorContrato[100] = segundaVia(titulo(6101, -6));
      const daBeltrana = await executeTool('gerar_pix', {}, turnoNoite(1, { terceiro: BELTRANA }));
      expect(daBeltrana.ok).toBe(true);
      expect(enviarPix.mock.calls[0][0].fatura.id).toBe(6001);
      expect(faturasNoturnas).toEqual({ 300: { faturaId: '6001', alvo: 'terceiro' } });

      // O alvo continua sendo a Beltrana: o contrato da Fulana não entra, nem lido.
      const silenciosa = await executeTool('gerar_pix', { contratoId: 100 }, turnoNoite(2, { terceiro: BELTRANA }));
      expect(silenciosa.ok).toBe(false);
      expect(silenciosa.motivo).toBe('financial_target_mismatch');
      expect(sgpClient.listAllInvoices).not.toHaveBeenCalledWith(100);

      // A cliente pediu a própria cobrança (o worker trocou o alvo para quem fala): a regra de 1
      // vencida do contrato dela vale, e a trava da Beltrana não a atinge.
      const daFulana = await executeTool('gerar_pix', { contratoId: 100 }, turnoNoite(3, { terceiro: null }));
      expect(daFulana.ok).toBe(true);
      expect(daFulana.resultado.enviado).toBe(true);
      expect(enviarPix.mock.calls[1][0].fatura.id).toBe(6101);
      expect(faturasNoturnas).toEqual({ 300: { faturaId: '6001', alvo: 'terceiro' } });
    });
  });
});

// ================================================================================================
// Ajuste de 25/09/2026 — boleto pago + comprovante válido + compensação pendente. "Pagamento
// confirmado" (o MESMO título relido como Pago com data) e "liberação em confiança" (o desbloqueio
// existente, com comprovante válido) são coisas separadas: a segunda não espera a primeira, e não a
// afirma. Nada das regras do desbloqueio muda; o SGP de escrita (liberacaopromessa) é mock.
describe('boleto pago + comprovante válido + compensação pendente', () => {
  let motivoGravado;
  const SUSPENSO = { ...CONTRATO_A, statusCode: 4, paymentPromisesThisMonth: 0 };
  const X = () => titulo(5801, -40);
  const Y = () => titulo(5802, -10);
  const COMPROVANTE = { valido: true, idTransacao: 'tx-sintetico-1', faturaId: 5801, contratoId: 100, valor: 99.9, tipo: 'boleto' };
  const turno = (n, extra = {}) => noite({ contracts: [SUSPENSO], messageId: `msg-${n}`, ...extra });
  const concluirEm = (setorId, c) => findTool('concluir_triagem').executar({
    setorId, motivoId: null, resumo: 'Cliente pagou o boleto e mandou o comprovante.', confianca: 0.9, pendenciasObrigatorias: [],
  }, c);

  beforeEach(() => {
    motivoGravado = null;
    setTriageReactivation.mockImplementation(async (_c, motivo) => { if (!motivoGravado) motivoGravado = motivo; });
    getTriageReactivation.mockImplementation(async () => motivoGravado);
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9 }, contracts: [SUSPENSO] });
    sgpClient.listInvoices.mockImplementation(async (id) => {
      const l = titulosPorContrato[id];
      return { faturas: l.faturas, paginacao: { total: l.faturas.length } };
    });
    listTrustUnlocksByContract.mockResolvedValue([]);
    recordTrustUnlock.mockResolvedValue({ id: 'tu-1' });
    claimReceipt.mockResolvedValue(true);
    releaseReceipt.mockResolvedValue();
  });

  /** O boleto da mais antiga saiu à noite, com 2 vencidas: a conversa já é do fluxo noturno de 2+. */
  async function boletoEnviado() {
    titulosPorContrato[100] = leitura([X(), Y()]);
    viasPorContrato[100] = segundaVia(Y(), X());
    const r = await findTool('enviar_boleto').executar({ contratoId: 100 }, turno(1));
    expect(r.enviado).toBe(true);
    expect(sgpClient.downloadBoletoPdf).toHaveBeenCalledWith('https://sgp.invalid/5801.pdf');
  }

  test('D. comprovante válido, título ainda Gerado: não confirma; o desbloqueio elegível roda e libera; segue reativação', async () => {
    await boletoEnviado();
    const c = turno(2, { comprovante: COMPROVANTE, ultimaFala: 'paguei o boleto, segue o comprovante' });

    const conferido = await findTool('conferir_pagamento').executar({}, c);
    expect(conferido.pagamentoConfirmado).toBe(false);
    expect(c.pagamentoConfirmado).not.toBe(true);

    // O desbloqueio em confiança NÃO espera o título virar Pago.
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: true, liberadoDias: 3, dataPromessa: dia(3), protocolo: 'PROTO-SINTETICO', motivo: null });
    const liberacao = await findTool('desbloqueio_confianca').executar({ contratoId: 100 }, c);
    expect(liberacao.liberado).toBe(true);
    expect(sgpClient.requestTrustUnlock).toHaveBeenCalledWith(100);
    expect(c.desbloqueioRealizado).toBe(true);
    // Liberação em confiança não é pagamento confirmado.
    expect(c.pagamentoConfirmado).not.toBe(true);
    expect(liberacao.instrucao).not.toMatch(/pagamento (foi |já foi )?confirmado/i);
    // A conclusão que a ferramenta pede é na reativação.
    expect(liberacao.instrucao).toContain(SETOR_REAT);

    // A frase certa passa; "pagamento confirmado" continua barrado.
    expect(violacoesDoPagamento('Recebi o comprovante e o acesso foi liberado em confiança enquanto o pagamento é processado.', c)).toEqual([]);
    expect(violacoesDoPagamento('Seu pagamento foi confirmado e o acesso liberado.', c)).toEqual(['pagamento_sem_confirmacao']);

    // Continua na reativação. Mais tarde a X baixa no SGP e sobra só a Y: a próxima cobrança NÃO
    // sai sozinha; a conclusão é só lá; nunca "resolvido".
    titulosPorContrato[100] = leitura([titulo(5801, -40, { pago: true }), Y()]);
    viasPorContrato[100] = segundaVia(Y());
    const outra = await findTool('gerar_pix').executar({ contratoId: 100 }, turno(3));
    expect(outra.cobrancaBloqueada).toBe('reativacao');
    expect(enviarPix).not.toHaveBeenCalled();
    expect((await concluirEm(SETOR_FIN, c)).concluido).toBe(false);
    expect((await concluirEm(SETOR_REAT, c)).concluido).toBe(true);
    expect(concludeAiTriage.mock.calls[0][1].resolvedByAi).toBe(false);
    expect(markTriageResolvedByAi).not.toHaveBeenCalled();
  });

  test('E. desbloqueio devolve liberado:false: nada de "internet liberada"', async () => {
    await boletoEnviado();
    const c = turno(2, { comprovante: COMPROVANTE });
    sgpClient.requestTrustUnlock.mockResolvedValue({ liberado: false, liberadoDias: null, dataPromessa: null, protocolo: null, motivo: 'Limite do provedor (sintético)' });
    const r = await findTool('desbloqueio_confianca').executar({ contratoId: 100 }, c);
    expect(r.liberado).toBe(false);
    expect(c.desbloqueioRealizado).not.toBe(true);
    expect(violacoesDoPagamento('Pronto, sua internet já foi liberada.', c)).toEqual(['liberacao_sem_fato']);
    expect(r.instrucao).not.toMatch(/automátic/i);
    expect(r.instrucao).toContain(SETOR_REAT);
  });

  test('F. só "paguei", sem SGP e sem comprovante válido: não confirma e não cria atalho de liberação', async () => {
    await boletoEnviado();
    const c = turno(2, { ultimaFala: 'já paguei' });
    const conferido = await findTool('conferir_pagamento').executar({}, c);
    expect(conferido.pagamentoConfirmado).toBe(false);
    expect(c.pagamentoConfirmado).not.toBe(true);
    expect(c.contratoAtivoConfirmado).not.toBe(true);
    expect(c.desbloqueioRealizado).not.toBe(true);
    expect(sgpClient.requestTrustUnlock).not.toHaveBeenCalled();
    expect(violacoesDoPagamento('Seu pagamento foi confirmado e a internet já foi liberada.', c))
      .toEqual(['pagamento_sem_confirmacao', 'liberacao_sem_fato']);
  });

  test('G. depois, a MESMA fatura vira Pago com data: aí sim o pagamento é confirmado (e a conversa segue na reativação)', async () => {
    await boletoEnviado();
    const antes = turno(2);
    expect((await findTool('conferir_pagamento').executar({}, antes)).pagamentoConfirmado).toBe(false);
    titulosPorContrato[100] = leitura([titulo(5801, -40, { pago: true }), Y()]);
    const depois = turno(3);
    const conferido = await findTool('conferir_pagamento').executar({}, depois);
    expect(conferido.pagamentoConfirmado).toBe(true);
    expect(depois.pagamentoConfirmado).toBe(true);
    expect(violacoesDoPagamento('Seu pagamento foi confirmado.', depois)).toEqual([]);
    // Pago não é liberado: o contrato relido continua suspenso.
    expect(depois.contratoAtivoConfirmado).not.toBe(true);
    expect(conferido.instrucao).toContain(SETOR_REAT);
    expect(markTriageResolvedByAi).not.toHaveBeenCalled();
  });
});

// P2-1 da auditoria final (25/09/2026): a verificação de conexão de TODOS os contratos também é
// fato de conexão — mas só com todos online (com um offline ou sem resposta, "está online" não vale).
describe('P2-1: consultar_status_todos_contratos como fato de conexão', () => {
  const todos = () => ctx({ contracts: [CONTRATO_A, CONTRATO_B], ferramentasPermitidas: ['consultar_status_todos_contratos'] });

  test('todos online: marca a conexão verificada', async () => {
    sgpClient.checkConnection.mockResolvedValue({ status: 1 });
    const c = todos();
    await findTool('consultar_status_todos_contratos').executar({}, c);
    expect(c.conexaoOnline).toBe(true);
  });

  test('um offline, ou sem resposta: não marca', async () => {
    sgpClient.checkConnection.mockResolvedValueOnce({ status: 1 }).mockResolvedValueOnce({ status: 2 });
    const offline = todos();
    await findTool('consultar_status_todos_contratos').executar({}, offline);
    expect(offline.conexaoOnline).not.toBe(true);

    sgpClient.checkConnection.mockResolvedValueOnce({ status: 1 }).mockRejectedValueOnce(new Error('sgp fora do ar'));
    const semResposta = todos();
    await findTool('consultar_status_todos_contratos').executar({}, semResposta);
    expect(semResposta.conexaoOnline).not.toBe(true);
  });

  test('a releitura de conferir_pagamento que acha o contrato NÃO ativo fica marcada para a guarda', async () => {
    findLatestEnqueuedDelivery.mockResolvedValue({ id: 'e-1', conversationId: 'c-fin', tool: 'gerar_pix', contractId: 100, invoiceId: '7001', enqueuedAt: new Date() });
    titulosPorContrato[100] = leitura([titulo(7001, -5, { pago: true })]);
    sgpClient.lookupClientByCpf.mockResolvedValue({ client: { id: 9 }, contracts: [{ ...CONTRATO_A, statusCode: 4 }] });
    const c = ctx();
    await findTool('conferir_pagamento').executar({}, c);
    expect(c.contratoAtivoNegado).toBe(true);
  });
});
