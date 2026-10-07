// Item 3 (07/10/2026, autorizado pelo proprietário): a geração de PIX que a consulta e a 2ª via não usam sai. Ponta a ponta
// sem serviço real: o cliente SGP é o REAL, com o HTTP (axios) simulado; as ferramentas são as reais. Prova que
// consultar_faturas_todos_contratos e gerar_segunda_via não chamam pagamento/pix e devolvem os mesmos dados de antes, e que
// gerar_pix (o PIX pedido pelo cliente) continua gerando o PIX quando a 2ª via não traz o código.
jest.mock('axios');
jest.mock('../integrations/sgp-query-config.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../payments/payment-sender');
jest.mock('./billing-delivery.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../media/media-storage');
jest.mock('../realtime/socket-server');
jest.mock('./ai-config.repository');
jest.mock('../cities/contact-city.service');
jest.mock('../city-notices/city-notice.service');
jest.mock('./trust-unlock.repository');
jest.mock('../sectors/sector.repository');
jest.mock('../reasons/reason.repository');
jest.mock('./triage-close-reason');
jest.mock('../conversations/message.repository');
jest.mock('./openai-client');
jest.mock('../company/company-config.repository');
jest.mock('./receipt-usage.repository');
jest.mock('../plans/plan.repository');
jest.mock('../cities/city.repository');

const axios = require('axios');
const { hojeEmSaoPaulo } = require('./situacao-financeira');
const { getSgpQueryConfig } = require('../integrations/sgp-query-config.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { enviarPix } = require('../payments/payment-sender');
const { claimDelivery } = require('./billing-delivery.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { executeTool } = require('./tool-executor');

const CONFIG_SGP = { baseUrl: 'https://sgp.exemplo.invalido', app: 'teste', token: 'tok-teste', enabled: true };
const CPF = '12345678909';
const CONTRATOS = [{ id: 301, address: 'Rua de Teste, 300 - Bairro de Teste' }, { id: 302, address: 'Avenida de Teste, 30 - Outro Bairro de Teste' }];
const TRIAGEM = ['buscar_cliente', 'gerar_pix', 'enviar_boleto', 'gerar_segunda_via', 'consultar_faturas_todos_contratos'];

// Datas relativas ao dia de hoje em São Paulo: com data fixa, o teste trocaria de ramo (0 ou 1 vencida) sem avisar.
const HOJE = hojeEmSaoPaulo();
function dia(delta) {
  const d = new Date(`${HOJE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const A_VENCER = dia(18);
const A_VENCER_302 = dia(19);

// O SGP simulado por URL: títulos (leitura), 2ª via por contrato e pagamento/pix (geração). A fatura do 301 vem com ou sem o
// código PIX pronto, a vencer (0 vencidas) ou vencida há 3 dias (1 vencida: o SGP manda a 2ª via com a data de hoje); o 302
// não tem fatura em aberto.
function sgp({ codigoDaFatura301 = '', vencida = false } = {}) {
  const vencimento = vencida ? dia(-3) : A_VENCER;
  axios.post.mockImplementation(async (url, corpo) => {
    const contrato = /contrato=(\d+)/.exec(String(corpo))?.[1];
    if (url.endsWith('/api/central/titulos')) {
      return { data: { faturas: contrato === '301' ? [{ id: '3011', status: 'Gerado', statusid: 1, valor: 100, vencimento, vencimento_atualizado: vencida ? HOJE : vencimento }] : [], paginacao: { total: contrato === '301' ? 1 : 0 } } };
    }
    if (url.endsWith('/api/ura/fatura2via')) {
      if (contrato !== '301') return { data: { status: 1, links: [] } };
      return { data: { status: 1, links: [{ id: '3011', vencimento: vencida ? HOJE : vencimento, valor: 100, linhadigitavel: '836-301', codigopix: codigoDaFatura301, link: 'https://x/3011' }] } };
    }
    if (url.includes('/api/ura/pagamento/pix/')) return { data: { status: 1, pix: '000201-gerado' } };
    throw new Error(`URL inesperada no teste: ${url}`);
  });
}
const pediuPix = () => axios.post.mock.calls.filter(([url]) => url.includes('pagamento/pix'));

let n = 0;
function contexto(falas) {
  n += 1;
  return {
    conversationId: 'conv-1', channelId: 'ch-1', messageId: `msg-${n}`,
    contact: { id: 'ct-1', sgpDocument: CPF },
    contracts: CONTRATOS.map((c) => ({ id: c.id, address: c.address })),
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'Sicrano', client: { id: 9, document: CPF }, contestado: false },
    terceiro: null, alvoAmbiguo: false, ferramentasPermitidas: TRIAGEM, registroFerramentas: [], sgpCache: {},
    falasDoCliente: falas, ultimaFalaDoCliente: falas[falas.length - 1],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getSgpQueryConfig.mockResolvedValue(CONFIG_SGP);
  getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'waiting', triageState: 'pending', assignedAgentId: null });
  let claim = 0;
  claimDelivery.mockImplementation(async () => ({ obtido: true, registro: { id: `claim-${++claim}` } }));
  enviarPix.mockResolvedValue([{ id: 'm-cartao' }, { id: 'm-codigo' }]);
  enqueueOutboundMessage.mockResolvedValue({ id: 'out-1' });
});

test('consultar_faturas_todos_contratos (na triagem, com o meio escolhido): não gera PIX, e os dados são os mesmos', async () => {
  sgp();
  const semCodigo = await executeTool('consultar_faturas_todos_contratos', {}, contexto(['quero o boleto da minha internet']));
  expect(pediuPix()).toEqual([]);
  sgp({ codigoDaFatura301: '000201-pronto' });
  const comCodigo = await executeTool('consultar_faturas_todos_contratos', {}, contexto(['quero o boleto da minha internet']));
  expect(semCodigo.ok).toBe(true);
  expect(semCodigo.resultado.contratosComFaturaEmAberto).toEqual([expect.objectContaining({ contratoId: 301 })]);
  expect(semCodigo.resultado.contratos.map((c) => c.temFaturaEmAberto)).toEqual([true, false]);
  // Os dados da consulta não dependem do PIX: com e sem o código pronto, o mesmo resultado.
  expect(semCodigo.resultado).toEqual(comCodigo.resultado);
});

test('gerar_segunda_via: não gera PIX, e entrega a mesma linha digitável e o mesmo link', async () => {
  sgp();
  const r = await executeTool('gerar_segunda_via', { contratoId: 301 }, contexto(['manda a segunda via do boleto']));
  expect(pediuPix()).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.resultado.faturas).toEqual([{ faturaId: '3011', vencimento: A_VENCER, valor: 100, linhaDigitavel: '836-301', linkBoleto: 'https://x/3011' }]);
  sgp({ codigoDaFatura301: '000201-pronto' });
  const comCodigo = await executeTool('gerar_segunda_via', { contratoId: 301 }, contexto(['manda a segunda via do boleto']));
  expect(comCodigo.resultado.faturas).toEqual(r.resultado.faturas);
});

test('gerar_segunda_via com 1 vencida (a 2ª via do contrato pedido, sem busca em outro): não gera PIX, e entrega a mesma linha e o mesmo link', async () => {
  sgp({ vencida: true });
  const r = await executeTool('gerar_segunda_via', { contratoId: 301 }, contexto(['manda a segunda via do boleto']));
  expect(pediuPix()).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.resultado.faturas.map((f) => [f.faturaId, f.linhaDigitavel, f.linkBoleto])).toEqual([['3011', '836-301', 'https://x/3011']]);
  sgp({ codigoDaFatura301: '000201-pronto', vencida: true });
  const comCodigo = await executeTool('gerar_segunda_via', { contratoId: 301 }, contexto(['manda a segunda via do boleto']));
  expect(comCodigo.resultado.faturas).toEqual(r.resultado.faturas);
});

test('gerar_segunda_via sem fatura no contrato pedido: a do outro contrato dele, também sem gerar PIX', async () => {
  axios.post.mockImplementation(async (url, corpo) => {
    const contrato = /contrato=(\d+)/.exec(String(corpo))?.[1];
    if (url.endsWith('/api/central/titulos')) {
      return { data: { faturas: contrato === '302' ? [{ id: '3021', status: 'Gerado', statusid: 1, valor: 80, vencimento: A_VENCER_302 }] : [], paginacao: { total: contrato === '302' ? 1 : 0 } } };
    }
    if (url.endsWith('/api/ura/fatura2via')) {
      if (contrato !== '302') return { data: { status: 1, links: [] } };
      return { data: { status: 1, links: [{ id: '3021', vencimento: A_VENCER_302, valor: 80, linhadigitavel: '836-302', codigopix: '', link: 'https://x/3021' }] } };
    }
    if (url.includes('/api/ura/pagamento/pix/')) return { data: { status: 1, pix: '000201-gerado' } };
    throw new Error(`URL inesperada no teste: ${url}`);
  });
  const r = await executeTool('gerar_segunda_via', { contratoId: 301 }, contexto(['manda a segunda via do boleto']));
  expect(pediuPix()).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.resultado.faturas).toEqual([{ faturaId: '3021', vencimento: A_VENCER_302, valor: 80, linhaDigitavel: '836-302', linkBoleto: 'https://x/3021' }]);
  expect(r.resultado.contratoUsado).toEqual(expect.objectContaining({ contratoId: 302 }));
});

test('gerar_pix (o PIX pedido pelo cliente): sem código pronto na 2ª via, o PIX continua sendo gerado e entregue', async () => {
  sgp();
  const r = await executeTool('gerar_pix', { contratoId: 301 }, contexto(['manda o pix da minha internet']));
  expect(r.ok).toBe(true);
  expect(pediuPix()).toHaveLength(1);
  expect(enviarPix).toHaveBeenCalledWith(expect.objectContaining({ fatura: expect.objectContaining({ pixCode: '000201-gerado' }) }));
});
