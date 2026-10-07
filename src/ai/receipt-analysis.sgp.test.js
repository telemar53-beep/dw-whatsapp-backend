// N3 (06/10/2026, autorizado pelo proprietário): a análise do comprovante pede a 2ª via de cada contrato SEM gerar PIX.
// Ponta a ponta sem serviço real: o cliente SGP é o real, com o HTTP (axios) simulado; a conferência é a real. Prova que a
// conferência dá o mesmo resultado (mesma fatura, mesmo contrato, mesmos motivos), que pagamento/pix nunca é chamado, e que
// as falhas continuam tratadas como antes (um contrato fora não derruba os outros).
jest.mock('axios');
jest.mock('../integrations/sgp-query-config.repository');
jest.mock('./openai-client');
jest.mock('../company/company-config.repository');
jest.mock('./receipt-usage.repository');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  getMediaFilePath: jest.fn(() => '/tmp/comprovante.jpg'),
}));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), promises: { stat: jest.fn(), readFile: jest.fn() } }));

const fs = require('fs');
const axios = require('axios');
const { getSgpQueryConfig } = require('../integrations/sgp-query-config.repository');
const { analyzeImage } = require('./openai-client');
const { getCompanyConfig } = require('../company/company-config.repository');
const { findReceiptUsage, claimReceipt } = require('./receipt-usage.repository');
const { analisarComprovante } = require('./receipt-analysis');

const CONFIG_SGP = { baseUrl: 'https://sgp.exemplo.invalido', app: 'teste', token: 'tok-teste', enabled: true };
const CONFIG = { apiKey: 'chave-de-teste', model: 'modelo-de-teste' };
const IMAGEM = { id: 'msg-1', mediaPath: 'comprovante.jpg', mediaMimeType: 'image/jpeg' };
// O dia de São Paulo (a conferência compara com ele); o de UTC faria o teste falhar das 21h às 23h59.
const { hojeEmSaoPaulo } = require('./situacao-financeira');
const HOJE = hojeEmSaoPaulo();
const CONTRATOS = [{ id: 301 }, { id: 302 }];

// O SGP simulado por URL: títulos (leitura), 2ª via por contrato e pagamento/pix (geração).
function sgp({ codigoDaFatura301 = '', falha302 = false } = {}) {
  axios.post.mockImplementation(async (url, corpo) => {
    const contrato = /contrato=(\d+)/.exec(String(corpo))?.[1];
    if (url.endsWith('/api/central/titulos')) return { data: { faturas: [] } };
    if (url.endsWith('/api/ura/fatura2via')) {
      if (contrato === '302' && falha302) throw new Error('SGP fora');
      const links = contrato === '301'
        ? [{ id: '3011', vencimento: '2026-10-10', valor: 100, linhadigitavel: '836-301', codigopix: codigoDaFatura301, link: 'https://x/3011' }]
        : [{ id: '3021', vencimento: '2026-10-12', valor: 50, linhadigitavel: '836-302', codigopix: '000201-302', link: 'https://x/3021' }];
      return { data: { status: 1, links } };
    }
    if (url.includes('/api/ura/pagamento/pix/')) return { data: { status: 1, pix: '000201-gerado' } };
    throw new Error(`URL inesperada no teste: ${url}`);
  });
}
const pediuPix = () => axios.post.mock.calls.filter(([url]) => url.includes('pagamento/pix'));

beforeEach(() => {
  jest.clearAllMocks();
  getSgpQueryConfig.mockResolvedValue(CONFIG_SGP);
  fs.promises.stat.mockResolvedValue({ size: 1024 });
  fs.promises.readFile.mockResolvedValue(Buffer.from('imagem'));
  getCompanyConfig.mockResolvedValue({ acceptedPayeeNames: ['EMPRESA DE TESTE'] });
  findReceiptUsage.mockResolvedValue(null);
  analyzeImage.mockResolvedValue({ ehComprovante: true, tipo: 'pix', valor: 100, data: HOJE, favorecido: 'EMPRESA DE TESTE', confianca: 0.95, idTransacao: 'E-TESTE-1' });
});

test('a conferência casa a fatura certa do contrato certo, e pagamento/pix nunca é chamado', async () => {
  sgp();
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(r).toMatchObject({ analisado: true, valido: true, faturaId: '3011', contratoId: 301, jaUtilizado: false });
  expect(pediuPix()).toEqual([]);
  expect(axios.post.mock.calls.filter(([url]) => url.endsWith('/api/ura/fatura2via'))).toHaveLength(2);
});

test('mesmo resultado com e sem código PIX pronto na 2ª via (a conferência não depende do PIX)', async () => {
  sgp({ codigoDaFatura301: '' });
  const semCodigo = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  sgp({ codigoDaFatura301: '000201-pronto' });
  const comCodigo = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(semCodigo).toEqual(comCodigo);
  expect(pediuPix()).toEqual([]);
});

test('mesmo resultado que o caminho antigo, que gerava o PIX (a 2ª via pedida no padrão)', async () => {
  sgp();
  const sgpClient = require('../integrations/sgp-client');
  const real = sgpClient.getDuplicateInvoice;
  // O caminho antigo: a 2ª via no padrão, ignorando a opção — e aí o PIX da fatura sem código é gerado.
  const antigo = jest.spyOn(sgpClient, 'getDuplicateInvoice').mockImplementation((id) => real(id));
  const resultadoAntigo = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(pediuPix().length).toBeGreaterThan(0);
  antigo.mockRestore();
  axios.post.mockClear();
  const resultadoNovo = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(resultadoNovo).toEqual(resultadoAntigo);
  expect(pediuPix()).toEqual([]);
});

test('valor que não bate com nenhuma fatura: o mesmo motivo de sempre', async () => {
  sgp();
  analyzeImage.mockResolvedValue({ ehComprovante: true, tipo: 'pix', valor: 77, data: HOJE, favorecido: 'EMPRESA DE TESTE', confianca: 0.95, idTransacao: 'E-TESTE-2' });
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(r).toMatchObject({ analisado: true, valido: false, faturaId: null, contratoId: null });
  expect(r.motivos).toContain('valor não corresponde a nenhuma fatura em aberto');
  expect(pediuPix()).toEqual([]);
});

test('a 2ª via de um contrato falha: a conferência segue com o outro, como antes', async () => {
  sgp({ falha302: true });
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(r).toMatchObject({ analisado: true, valido: true, faturaId: '3011', contratoId: 301 });
  expect(pediuPix()).toEqual([]);
});

test('SGP fora para todos: sem exceção, sem fatura para casar, sem PIX pedido', async () => {
  axios.post.mockRejectedValue(new Error('SGP fora'));
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(r).toMatchObject({ analisado: true, valido: false, faturaId: null });
  expect(pediuPix()).toEqual([]);
});

// Item 2 (07/10/2026): "não foi possível conferir" não é "não existe fatura". O critério (válido ou não) não muda; só o motivo
// e o campo conferenciaDasFaturas dizem o que aconteceu. Nada é registrado como pagamento.
const MOTIVO_SEM_FATURA = 'valor não corresponde a nenhuma fatura em aberto';
test('consulta completa e o valor bate: confere, com a conferência das faturas completa', async () => {
  sgp();
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG, consultaDeContratos: 'ok' });
  expect(r).toMatchObject({ analisado: true, valido: true, faturaId: '3011', contratoId: 301, conferenciaDasFaturas: 'completa' });
  expect(claimReceipt).not.toHaveBeenCalled();
});

test('consulta completa e o valor não bate: o motivo de sempre ("não corresponde a nenhuma fatura")', async () => {
  sgp();
  analyzeImage.mockResolvedValue({ ehComprovante: true, tipo: 'pix', valor: 77, data: HOJE, favorecido: 'EMPRESA DE TESTE', confianca: 0.95, idTransacao: 'E-TESTE-2' });
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(r).toMatchObject({ valido: false, conferenciaDasFaturas: 'completa' });
  expect(r.motivos).toContain(MOTIVO_SEM_FATURA);
});

test('um contrato falha e o valor não bate com o outro: "não foi possível conferir com todas", não "não existe fatura"', async () => {
  sgp({ falha302: true });
  analyzeImage.mockResolvedValue({ ehComprovante: true, tipo: 'pix', valor: 50, data: HOJE, favorecido: 'EMPRESA DE TESTE', confianca: 0.95, idTransacao: 'E-TESTE-3' });
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(r).toMatchObject({ valido: false, conferenciaDasFaturas: 'incompleta' });
  expect(r.motivos).not.toContain(MOTIVO_SEM_FATURA);
  expect(r.motivos.join(' ')).toMatch(/não foi possível conferir o valor com todas as faturas/);
  expect(pediuPix()).toEqual([]);
});

test('SGP fora para todos os contratos: "não foi possível conferir", não "não existe fatura"', async () => {
  axios.post.mockRejectedValue(new Error('SGP fora'));
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
  expect(r).toMatchObject({ valido: false, conferenciaDasFaturas: 'indisponivel' });
  expect(r.motivos).not.toContain(MOTIVO_SEM_FATURA);
  expect(r.motivos.join(' ')).toMatch(/não foi possível conferir o valor: a consulta das faturas no SGP falhou/);
  expect(claimReceipt).not.toHaveBeenCalled();
});

test('a consulta dos contratos falhou (na rota): "não foi possível conferir", sem tocar no SGP', async () => {
  sgp();
  const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG, consultaDeContratos: 'falhou' });
  expect(r).toMatchObject({ valido: false, conferenciaDasFaturas: 'indisponivel' });
  expect(r.motivos.join(' ')).toMatch(/não foi possível conferir o valor: a consulta das faturas no SGP falhou/);
  expect(axios.post).not.toHaveBeenCalled();
});

test('nenhum contrato no SGP: diz que não há contrato para conferir; sem documento vinculado: diz que não deu para conferir', async () => {
  sgp();
  const semContrato = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG, consultaDeContratos: 'ok' });
  expect(semContrato).toMatchObject({ valido: false, conferenciaDasFaturas: 'sem_contratos' });
  expect(semContrato.motivos.join(' ')).toMatch(/nenhum contrato encontrado para este cliente no SGP/);
  const semDocumento = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG, consultaDeContratos: 'sem_documento' });
  expect(semDocumento).toMatchObject({ valido: false, conferenciaDasFaturas: 'sem_documento' });
  expect(semDocumento.motivos.join(' ')).toMatch(/não foi possível conferir o valor: o contato não está vinculado a um cadastro do SGP/);
  expect(axios.post).not.toHaveBeenCalled();
});

// Rodada 7 (achados 2.1 a 2.4 da revisão do comprovante): as situações da conferência do valor ficam distintas, e
// `naoConferido` só aparece quando a ÚNICA reprovação é não ter havido como conferir o valor. "Não confere" fica para o
// comprovante efetivamente divergente. O critério (válido ou não) não muda.
describe('as situações da conferência do valor', () => {
  const LEITURA = { ehComprovante: true, tipo: 'pix', valor: 100, data: HOJE, favorecido: 'EMPRESA DE TESTE', confianca: 0.95, idTransacao: 'E-TESTE-1' };
  const sgpSemFatura = () => axios.post.mockImplementation(async (url) => {
    if (url.endsWith('/api/central/titulos')) return { data: { faturas: [] } };
    if (url.endsWith('/api/ura/fatura2via')) return { data: { status: 0, links: [] } };
    throw new Error(`URL inesperada no teste: ${url}`);
  });

  test('integração desligada ou sem configuração (na rota): diz isso, não "nenhum contrato" nem "não corresponde"', async () => {
    const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG, consultaDeContratos: 'desligado' });
    expect(r).toMatchObject({ analisado: true, valido: false, conferenciaDasFaturas: 'desligado', naoConferido: 'desligado' });
    expect(r.motivos.join(' ')).toMatch(/não foi possível conferir o valor: a integração com o SGP está desligada ou sem configuração/);
    expect(r.motivos.join(' ')).not.toMatch(/nenhum contrato|não corresponde/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('consulta concluída e os contratos sem nenhuma fatura em aberto: "não há fatura em aberto", não "não corresponde"', async () => {
    sgpSemFatura();
    const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
    expect(r).toMatchObject({ valido: false, conferenciaDasFaturas: 'sem_faturas', naoConferido: 'sem_faturas' });
    expect(r.motivos.join(' ')).toMatch(/não há fatura em aberto nos contratos deste cliente para conferir o valor/);
    expect(r.motivos).not.toContain(MOTIVO_SEM_FATURA);
    expect(pediuPix()).toEqual([]);
  });

  test.each([
    ['consulta indisponível', () => axios.post.mockRejectedValue(new Error('SGP fora')), CONTRATOS, 'ok', 'indisponivel'],
    ['nenhum contrato no SGP', () => sgp(), [], 'ok', 'sem_contratos'],
    ['sem documento vinculado', () => sgp(), [], 'sem_documento', 'sem_documento'],
  ])('%s, e só o valor ficou sem conferir: naoConferido diz qual', async (_, preparar, contratos, consultaDeContratos, esperado) => {
    preparar();
    const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos, config: CONFIG, consultaDeContratos });
    expect(r).toMatchObject({ valido: false, conferenciaDasFaturas: esperado, naoConferido: esperado });
  });

  test('comprovante efetivamente divergente (há fatura em aberto e o valor não bate): naoConferido vazio, o motivo de sempre', async () => {
    sgp();
    analyzeImage.mockResolvedValue({ ...LEITURA, valor: 77 });
    const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
    expect(r).toMatchObject({ valido: false, conferenciaDasFaturas: 'completa', naoConferido: null });
    expect(r.motivos).toContain(MOTIVO_SEM_FATURA);
  });

  test('divergente por outro critério (favorecido), mesmo com o SGP fora: naoConferido vazio — o comprovante não confere', async () => {
    axios.post.mockRejectedValue(new Error('SGP fora'));
    analyzeImage.mockResolvedValue({ ...LEITURA, favorecido: 'OUTRA EMPRESA QUALQUER' });
    const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
    expect(r).toMatchObject({ valido: false, naoConferido: null });
    expect(r.motivos.join(' ')).toMatch(/favorecido/);
  });

  test('comprovante que confere: naoConferido vazio', async () => {
    sgp();
    const r = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: CONTRATOS, config: CONFIG });
    expect(r).toMatchObject({ valido: true, naoConferido: null });
  });
});
