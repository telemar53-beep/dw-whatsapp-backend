jest.mock('axios');
const axios = require('axios');
const { lerRecebedorDoPix, resolverRecebedorPix } = require('./pix-emv');

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

/** Monta um TLV `II LL VVV…` — mesmo formato que `lerTlvs` (no arquivo de
 * produção) desmonta, só que na direção contrária. Usado para montar códigos
 * de teste sem contar dígito de tamanho na mão. */
function tlv(id, valor) {
  return `${id}${String(valor.length).padStart(2, '0')}${valor}`;
}

/** Monta um código dinâmico igual ao DINAMICO acima (mesmo nome, mesma
 * "SAO LUIS" etc.), mas com a subtag 25 (URL de cobrança) trocada pela
 * fornecida — para os casos em que a URL deve ser rejeitada antes de
 * qualquer chamada de rede. */
function codigoDinamicoComUrl(urlSubtag) {
  const mai = tlv('00', 'BR.GOV.BCB.PIX') + tlv('25', urlSubtag);
  return (
    tlv('00', '01') +
    tlv('26', mai) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', '13.50') +
    tlv('58', 'BR') +
    tlv('59', 'DW TELECOM') +
    tlv('60', 'SAO LUIS') +
    tlv('62', tlv('05', '***')) +
    '6304ABCD'
  );
}
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

describe('resolverRecebedorPix', () => {
  beforeEach(() => {
    axios.get.mockReset();
  });

  test('código estático: devolve o mesmo resultado de lerRecebedorDoPix sem chamar a rede', async () => {
    await expect(resolverRecebedorPix(EVP)).resolves.toEqual(lerRecebedorDoPix(EVP));
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('código dinâmico: busca a URL da cobrança e resolve a chave da resposta', async () => {
    axios.get.mockResolvedValue({ data: { chave: 'financeiro@example.com' } });
    await expect(resolverRecebedorPix(DINAMICO)).resolves.toEqual({
      name: 'DW TELECOM',
      key: 'financeiro@example.com',
      keyType: 'EMAIL',
    });
    expect(axios.get).toHaveBeenCalledWith('https://pix.example.com/qr/v2/abc123', {
      timeout: 5000,
      signal: expect.any(AbortSignal),
      maxRedirects: 0,
      maxContentLength: 64 * 1024,
      responseType: 'json',
    });
  });

  test('código dinâmico: erro de rede devolve o resultado original, sem lançar', async () => {
    axios.get.mockRejectedValue(new Error('network error'));
    await expect(resolverRecebedorPix(DINAMICO)).resolves.toEqual({
      name: 'DW TELECOM',
      key: null,
      keyType: null,
    });
  });

  test('código dinâmico: resposta sem o campo chave devolve o resultado original', async () => {
    axios.get.mockResolvedValue({ data: {} });
    await expect(resolverRecebedorPix(DINAMICO)).resolves.toEqual({
      name: 'DW TELECOM',
      key: null,
      keyType: null,
    });
  });

  test('texto que não é código Pix EMV devolve null sem chamar a rede', async () => {
    await expect(resolverRecebedorPix('boleto 34191.79001 01043.510047')).resolves.toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('código estático com chave CNPJ também evita a rede (fixture realista reaproveitada)', async () => {
    await expect(resolverRecebedorPix(CNPJ)).resolves.toEqual(lerRecebedorDoPix(CNPJ));
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('URL com userinfo (truque @host) é rejeitada sem chamar a rede', async () => {
    const codigo = codigoDinamicoComUrl('something@evil.example.com/x');
    await expect(resolverRecebedorPix(codigo)).resolves.toEqual(lerRecebedorDoPix(codigo));
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('URL com literal de IPv4 é rejeitada sem chamar a rede', async () => {
    const codigo = codigoDinamicoComUrl('169.254.169.254/latest/meta-data/');
    await expect(resolverRecebedorPix(codigo)).resolves.toEqual(lerRecebedorDoPix(codigo));
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('URL apontando para localhost é rejeitada sem chamar a rede', async () => {
    const codigo = codigoDinamicoComUrl('localhost/x');
    await expect(resolverRecebedorPix(codigo)).resolves.toEqual(lerRecebedorDoPix(codigo));
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('timeout na busca devolve key null, não lança, e o aviso no log não carrega URL nem código', async () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const erro = new Error('timeout of 5000ms exceeded');
    erro.code = 'ECONNABORTED';
    axios.get.mockRejectedValue(erro);

    await expect(resolverRecebedorPix(DINAMICO)).resolves.toEqual({
      name: 'DW TELECOM',
      key: null,
      keyType: null,
    });

    expect(aviso).toHaveBeenCalled();
    const logado = aviso.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logado).toContain('ECONNABORTED');
    expect(logado).not.toContain('pix.example.com');
    expect(logado).not.toContain(DINAMICO);
    aviso.mockRestore();
  });
});
