const { lerRecebedorDoPix } = require('./pix-emv');

// Códigos montados no padrão EMV/BR Code (TLV: 2 dígitos de id, 2 de tamanho,
// valor). São códigos de teste, nunca de cliente.
const EVP =
  '00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d520400005303986540513.505802BR5910DW TELECOM6008SAO LUIS62070503***6304ABCD';
const CNPJ =
  '00020126360014BR.GOV.BCB.PIX011412345678000199520400005303986540513.505802BR5915DW TELECOM LTDA6008SAO LUIS62070503***6304ABCD';
const EMAIL =
  '00020126490014BR.GOV.BCB.PIX0127financeiro@dwtelecom.com.br520400005303986540513.505802BR5910DW TELECOM6008SAO LUIS62070503***6304ABCD';
const DINAMICO =
  '00020126500014BR.GOV.BCB.PIX2528pix.example.com/qr/v2/abc123520400005303986540513.505802BR5910DW TELECOM6008SAO LUIS62070503***6304ABCD';
const GUI_MINUSCULO =
  '00020126330014br.gov.bcb.pix011112345678909520400005303986540513.505802BR5910DW TELECOM6008SAO LUIS62070503***6304ABCD';
const SEM_NOME =
  '00020126360014BR.GOV.BCB.PIX0114+5598999990000520400005303986540513.505802BR6008SAO LUIS62070503***6304ABCD';
const NOME_COM_ESPACOS =
  '00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d520400005303986540513.505802BR5914  DW TELECOM  6008SAO LUIS62070503***6304ABCD';

describe('lerRecebedorDoPix', () => {
  test('lê nome, chave aleatória e tipo EVP de um código estático', () => {
    expect(lerRecebedorDoPix(EVP)).toEqual({
      name: 'DW TELECOM',
      key: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      keyType: 'EVP',
    });
  });

  test('reconhece chave CNPJ (14 dígitos)', () => {
    expect(lerRecebedorDoPix(CNPJ)).toEqual({
      name: 'DW TELECOM LTDA',
      key: '12345678000199',
      keyType: 'CNPJ',
    });
  });

  test('reconhece chave de e-mail', () => {
    expect(lerRecebedorDoPix(EMAIL)).toEqual({
      name: 'DW TELECOM',
      key: 'financeiro@dwtelecom.com.br',
      keyType: 'EMAIL',
    });
  });

  test('reconhece chave de telefone e devolve name null quando não há tag 59', () => {
    expect(lerRecebedorDoPix(SEM_NOME)).toEqual({
      name: null,
      key: '+5598999990000',
      keyType: 'PHONE',
    });
  });

  test('reconhece chave de CPF (11 dígitos) com o GUI em minúsculas', () => {
    expect(lerRecebedorDoPix(GUI_MINUSCULO)).toEqual({
      name: 'DW TELECOM',
      key: '12345678909',
      keyType: 'CPF',
    });
  });

  test('código dinâmico (só URL na subtag 25) devolve chave null, mas com o nome', () => {
    expect(lerRecebedorDoPix(DINAMICO)).toEqual({ name: 'DW TELECOM', key: null, keyType: null });
  });

  test('tira os espaços em volta do nome', () => {
    expect(lerRecebedorDoPix(NOME_COM_ESPACOS).name).toBe('DW TELECOM');
  });

  test('devolve null para texto que não é código Pix EMV', () => {
    expect(lerRecebedorDoPix('boleto 34191.79001 01043.510047')).toBeNull();
    expect(lerRecebedorDoPix('')).toBeNull();
    expect(lerRecebedorDoPix(null)).toBeNull();
    expect(lerRecebedorDoPix(undefined)).toBeNull();
  });

  test('devolve null para EMV sem o GUI do Pix', () => {
    const semPix = '00020126120008OUTRO.GUI520400005303986540513.505802BR5910DW TELECOM6304ABCD';
    expect(lerRecebedorDoPix(semPix)).toBeNull();
  });

  test('não lança com código truncado ou com tamanhos malucos', () => {
    expect(lerRecebedorDoPix('00020126580014BR.GOV.BCB.PIX01')).toBeNull();
    expect(lerRecebedorDoPix('0002012699')).toBeNull();
    expect(lerRecebedorDoPix('000201' + '26xx0014BR.GOV.BCB.PIX')).toBeNull();
  });
});
