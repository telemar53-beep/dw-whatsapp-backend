const { formatarValor, formatarData, cartaoPix, cartaoPixQr, cartaoBoleto } = require('./payment-card');

describe('formatarValor', () => {
  test('formata número como moeda BRL', () => {
    expect(formatarValor(135)).toBe((135).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  });

  test('formata string numérica', () => {
    expect(formatarValor('89.9')).toBe((89.9).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  });

  test('devolve "R$ " + valor original quando não é um número', () => {
    expect(formatarValor('abc')).toBe('R$ abc');
  });
});

describe('formatarData', () => {
  test('converte AAAA-MM-DD para DD/MM/AAAA', () => {
    expect(formatarData('2026-09-15')).toBe('15/09/2026');
  });

  test('devolve a string original quando não está no padrão AAAA-MM-DD', () => {
    expect(formatarData('15/09/2026')).toBe('15/09/2026');
    expect(formatarData('data inválida')).toBe('data inválida');
  });
});

describe('cartaoPix', () => {
  test('monta o cartão com valor, vencimento e instrução de copia e cola', () => {
    const texto = cartaoPix({ valor: 135, vencimento: '2026-09-15' });
    expect(texto).toBe(
      '💠 PIX da fatura\n' +
      `Valor: ${formatarValor(135)}\n` +
      'Vencimento: 15/09/2026\n' +
      '\n' +
      'Copie o código da próxima mensagem e cole no app do banco em Pix > Pix Copia e Cola.'
    );
    expect(texto).not.toMatch(/[*]/);
  });
});

describe('cartaoPixQr', () => {
  test('monta a legenda do QR com instrução de escanear ou copiar', () => {
    const texto = cartaoPixQr({ valor: 135, vencimento: '2026-09-15' });
    expect(texto).toBe(
      '💠 PIX da fatura\n' +
      `Valor: ${formatarValor(135)}\n` +
      'Vencimento: 15/09/2026\n' +
      '\n' +
      'Escaneie este QR no app do banco, ou copie o código da próxima mensagem em Pix > Pix Copia e Cola.'
    );
    expect(texto).not.toMatch(/[*]/);
  });
});

describe('cartaoBoleto', () => {
  test('monta o cartão de boleto com instrução de linha digitável', () => {
    const texto = cartaoBoleto({ valor: 135, vencimento: '2026-09-15' });
    expect(texto).toBe(
      '🧾 Boleto da fatura\n' +
      `Valor: ${formatarValor(135)}\n` +
      'Vencimento: 15/09/2026\n' +
      '\n' +
      'Copie a linha digitável da próxima mensagem e cole no app do banco em Pagar > Boleto.'
    );
    expect(texto).not.toMatch(/[*]/);
  });
});
