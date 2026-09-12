const { paraWhatsApp } = require('./whatsapp-format');

describe('paraWhatsApp', () => {
  test('converte negrito markdown (**) para o asterisco simples do WhatsApp', () => {
    expect(paraWhatsApp('preciso saber **qual contrato** consultar')).toBe('preciso saber *qual contrato* consultar');
  });

  test('converte itálico markdown (__) para o sublinhado simples', () => {
    expect(paraWhatsApp('vence __amanhã__')).toBe('vence _amanhã_');
  });

  test('remove marcadores de título no começo da linha', () => {
    expect(paraWhatsApp('## Faturas em aberto\n- R$ 99,90')).toBe('Faturas em aberto\n- R$ 99,90');
  });

  test('troca bullet com asterisco por hífen, para não virar negrito quebrado', () => {
    expect(paraWhatsApp('* primeira\n* segunda')).toBe('- primeira\n- segunda');
  });

  test('desfaz link markdown mantendo texto e URL', () => {
    expect(paraWhatsApp('segunda via: [boleto](https://x.y/b.pdf)')).toBe('segunda via: boleto (https://x.y/b.pdf)');
  });

  test('não mexe em texto que já está no formato do WhatsApp', () => {
    const texto = 'Olá! *Fatura* de R$ 99,90 vence _hoje_.\n- Pix\n- Boleto';
    expect(paraWhatsApp(texto)).toBe(texto);
  });

  test('preserva o código PIX copia e cola intacto', () => {
    const pix = '00020126580014br.gov.bcb.pix0136a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d5204000053039865802BR';
    expect(paraWhatsApp(`Seu código:\n${pix}`)).toBe(`Seu código:\n${pix}`);
  });

  test('devolve nulo e vazio sem quebrar', () => {
    expect(paraWhatsApp(null)).toBeNull();
    expect(paraWhatsApp('')).toBe('');
  });
});
