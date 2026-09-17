jest.mock('./openai-client');
jest.mock('./comprovante', () => ({
  ...jest.requireActual('./comprovante'),
}));
jest.mock('../company/company-config.repository');
jest.mock('./receipt-usage.repository');
jest.mock('../integrations/sgp-client');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  getMediaFilePath: jest.fn(() => '/tmp/comprovante.jpg'),
}));
jest.mock('fs', () => ({
  promises: { stat: jest.fn(), readFile: jest.fn() },
}));

const fs = require('fs');
const { analyzeImage } = require('./openai-client');
const { getCompanyConfig } = require('../company/company-config.repository');
const { findReceiptUsage } = require('./receipt-usage.repository');
const sgpClient = require('../integrations/sgp-client');
const { analisarComprovante } = require('./receipt-analysis');

const CONFIG = { apiKey: 'sk-1', model: 'gpt-x' };
const IMAGEM = { id: 'msg-1', mediaPath: 'comprovante.jpg', mediaMimeType: 'image/jpeg' };

function leituraBoa(extra = {}) {
  return {
    ehComprovante: true,
    tipo: 'pix',
    valor: 100,
    data: new Date().toISOString().slice(0, 10),
    favorecido: 'DW TELECOM',
    confianca: 0.95,
    idTransacao: 'E1234',
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fs.promises.stat.mockResolvedValue({ size: 1024 });
  fs.promises.readFile.mockResolvedValue(Buffer.from('imagem'));
  getCompanyConfig.mockResolvedValue({ acceptedPayeeNames: ['DW TELECOM'] });
  findReceiptUsage.mockResolvedValue(null);
  analyzeImage.mockResolvedValue(leituraBoa());
});

describe('analisarComprovante', () => {
  test('lê a imagem e devolve o veredito da conferência', async () => {
    const resultado = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG });

    expect(resultado.analisado).toBe(true);
    expect(resultado.valor).toBe(100);
    expect(analyzeImage).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg' }));
  });

  // Sem nome cadastrado não há como conferir favorecido — e a recusa sai ANTES
  // da visão, que é cobrada por imagem.
  test('recusa antes de chamar a visão quando não há favorecido cadastrado', async () => {
    getCompanyConfig.mockResolvedValue({ acceptedPayeeNames: [] });

    const resultado = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG });

    expect(resultado.analisado).toBe(false);
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  test('recusa formato que a visão não lê, sem abrir o arquivo', async () => {
    const resultado = await analisarComprovante({
      conversationId: 'c1',
      imagem: { ...IMAGEM, mediaMimeType: 'application/pdf' },
      contratos: [],
      config: CONFIG,
    });

    expect(resultado.analisado).toBe(false);
    expect(resultado.motivo).toMatch(/JPG, PNG ou WEBP/);
    expect(fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('recusa imagem grande demais', async () => {
    fs.promises.stat.mockResolvedValue({ size: 9 * 1024 * 1024 });

    const resultado = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG });

    expect(resultado.analisado).toBe(false);
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  test('a visão fora do ar não derruba a análise', async () => {
    analyzeImage.mockRejectedValue(new Error('timeout'));

    const resultado = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG });

    expect(resultado.analisado).toBe(false);
  });

  // O ponto que mais importa para o atendente: o mesmo comprovante reenviado.
  test('avisa quando o comprovante já foi usado antes', async () => {
    findReceiptUsage.mockResolvedValue({ contractId: 'ctr-9', usedAt: new Date('2026-09-10T10:00:00Z') });

    const resultado = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG });

    expect(resultado.jaUtilizado).toBe(true);
    expect(resultado.usoAnterior).not.toBeNull();
  });

  test('sem contratos, ainda confere favorecido, data e uso anterior', async () => {
    const resultado = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG });

    expect(resultado.analisado).toBe(true);
    expect(sgpClient.getDuplicateInvoice).not.toHaveBeenCalled();
    expect(resultado.jaUtilizado).toBe(false);
  });

  test('com contratos, busca as faturas em aberto para casar o valor', async () => {
    sgpClient.getDuplicateInvoice.mockResolvedValue({
      hasOpenInvoice: true,
      duplicates: [{ id: 'f-1', value: 100, dueDate: '2026-09-20' }],
    });

    const resultado = await analisarComprovante({
      conversationId: 'c1',
      imagem: IMAGEM,
      contratos: [{ id: 'ctr-1' }],
      config: CONFIG,
    });

    expect(sgpClient.getDuplicateInvoice).toHaveBeenCalledWith('ctr-1');
    expect(resultado.faturaId).toBe('f-1');
    expect(resultado.contratoId).toBe('ctr-1');
  });

  // O banco fora do ar não pode apagar a leitura inteira: sem a consulta, a
  // conferência ainda vale, só fica sem o aviso de reuso.
  test('uso anterior indisponível não derruba a análise', async () => {
    findReceiptUsage.mockRejectedValue(new Error('db fora'));

    const resultado = await analisarComprovante({ conversationId: 'c1', imagem: IMAGEM, contratos: [], config: CONFIG });

    expect(resultado.analisado).toBe(true);
    expect(resultado.jaUtilizado).toBe(false);
  });
});
