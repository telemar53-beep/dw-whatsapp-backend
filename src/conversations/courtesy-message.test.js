const fs = require('fs');
const { ehMensagemDeCortesia } = require('./courtesy-message');

const texto = (content) => ehMensagemDeCortesia({ content, messageType: 'text' });

describe('ehMensagemDeCortesia', () => {
  test('agradecimentos, confirmações e despedidas curtas são cortesia', () => {
    expect(texto('Obrigado')).toBe(true);
    expect(texto('vlw obrigado')).toBe(true);
    expect(texto('ok')).toBe(true);
    expect(texto('Blz, obrigada!')).toBe(true);
    expect(texto('Ótimo dia para você também')).toBe(true);
    expect(texto('Ótimo dia para você também!! 😊')).toBe(true);
    expect(texto('Bom dia pra vc tbm')).toBe(true);
    expect(texto('Tenha uma boa tarde')).toBe(true);
    expect(texto('Deus abençoe')).toBe(true);
    expect(texto('Muito obrigado pela atenção, tudo certo')).toBe(true);
    expect(texto('Show, deu certo aqui, obrigado')).toBe(true);
    expect(texto('Até mais')).toBe(true);
  });

  test('só emoji, só figurinha e joinha são cortesia', () => {
    expect(texto('👍')).toBe(true);
    expect(texto('🙏🙏')).toBe(true);
    expect(texto('❤️')).toBe(true);
    expect(ehMensagemDeCortesia({ content: null, messageType: 'sticker' })).toBe(true);
  });

  test('pergunta, número, pedido novo ou texto longo NÃO é cortesia', () => {
    expect(texto('Obrigado, e minha internet?')).toBe(false);
    expect(texto('ok mas o boleto veio errado')).toBe(false);
    expect(texto('Obrigado. Quero o boleto de outubro')).toBe(false);
    expect(texto('Paguei 135 reais')).toBe(false);
    expect(texto('Minha internet tá cortada')).toBe(false);
    expect(texto('Obrigado, mas ainda não consegui acessar o site da empresa para ver o extrato da fatura anterior')).toBe(false);
    expect(texto('')).toBe(false);
    expect(texto('   ')).toBe(false);
  });

  test('mídia real nunca é cortesia', () => {
    expect(ehMensagemDeCortesia({ content: null, messageType: 'audio' })).toBe(false);
    expect(ehMensagemDeCortesia({ content: 'obrigado', messageType: 'image' })).toBe(false);
    expect(ehMensagemDeCortesia({ content: null, messageType: 'document' })).toBe(false);
  });

  // Task 19: o produto é vendido para outros provedores — o nome comercial não
  // pode estar escrito no código. nomeDaEmpresa é opcional e vem do painel
  // (company_config), passado pelo chamador (inbound-message.service.js).
  test('a cortesia reconhece o nome de qualquer empresa, não só uma', () => {
    expect(ehMensagemDeCortesia({ content: 'obrigado Provedor X', messageType: 'text', nomeDaEmpresa: 'Provedor X' })).toBe(true);
    expect(ehMensagemDeCortesia({ content: 'obrigado DW Telecom', messageType: 'text', nomeDaEmpresa: 'DW Telecom' })).toBe(true);
  });

  test('o classificador de cortesia não tem nome de marca embutido', () => {
    const fonte = fs.readFileSync(require.resolve('./courtesy-message'), 'utf8');
    expect(fonte).not.toMatch(/'dw'|'telecom'/i);
  });
});
