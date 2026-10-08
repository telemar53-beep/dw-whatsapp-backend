const { violacoesDaEntrega, respostaSemEntregaSemFato, ENTREGA_NAO_FEITA } = require('./anuncio-de-entrega');

// Rodada 10 (08/10/2026; ordem, item 3, G1): sem entrega, o texto final não a apresenta como concluída nem como trabalho que
// continuará sozinho. A proteção depende do ESTADO da ação (houve entrega neste turno? alguma vez nesta conversa?).
const SEM_NADA = { entregaNoTurno: false, entregaAnterior: false };
const COM_ANTERIOR = { entregaNoTurno: false, entregaAnterior: true };
const NO_TURNO = { entregaNoTurno: true, entregaAnterior: false };

describe('violacoesDaEntrega', () => {
  test.each([
    ['Posso sim, Sicrano. Vou usar a fatura do endereço da *Rua de Teste, 300 - Bairro de Teste - Cidade de Teste/UF*.'],
    ['Certo! Vou seguir com o boleto da Rua de Teste.'],
    ['Já estou gerando o seu PIX.'],
    ['Um instante que já te mando o boleto.'],
    ['Seu boleto será enviado em seguida.'],
    ['Vou verificar a sua fatura e já te retorno.'],
    ['Perfeito, vou providenciar a segunda via.'],
    ['Irei emitir o boleto agora.'],
  ])('sem entrega no turno, %j apresenta a entrega como trabalho que continua: violação', (texto) => {
    expect(violacoesDaEntrega(texto, SEM_NADA)).toContain('entrega_futura');
    expect(violacoesDaEntrega(texto, COM_ANTERIOR)).toContain('entrega_futura');
  });
  test.each([
    ['Enviei acima o boleto referente ao seu contrato.'],
    ['Prontinho! O PIX já foi enviado.'],
    ['Segue o boleto em PDF.'],
    ['Reenviei o boleto acima.'],
    ['O boleto está aí em cima.'],
  ])('sem entrega nenhuma na conversa, %j dá a entrega como feita: violação', (texto) => {
    expect(violacoesDaEntrega(texto, SEM_NADA)).toContain('entrega_concluida');
  });
  test('com entrega anterior na conversa, a referência a ela é legítima', () => {
    expect(violacoesDaEntrega('O boleto já foi enviado logo acima, é só rolar a conversa.', COM_ANTERIOR)).toEqual([]);
    expect(violacoesDaEntrega('Enviei acima o boleto.', COM_ANTERIOR)).toEqual([]);
  });
  test('com entrega neste turno, nada é violação', () => {
    expect(violacoesDaEntrega('Prontinho! Enviei acima o PIX. Vou te mandar também o boleto.', NO_TURNO)).toEqual([]);
  });
  test.each([
    ['Você quer pagar por boleto ou por PIX? Assim que você escolher, eu vejo se ele está disponível para esta fatura.'],
    ['Não consegui enviar o boleto agora.'],
    ['O boleto não foi enviado: há mais de uma fatura vencida.'],
    ['Para enviar o boleto, preciso que você confirme: é o da Rua de Teste ou o da Avenida de Teste?'],
    ['Se quiser, eu envio o PIX desta fatura.'],
    ['Se você quiser, vou enviar o boleto da Rua de Teste.'],
    ['Assim que você me disser o endereço, vou enviar o boleto.'],
    ['Quer que eu reenvie o boleto?'],
    ['Vou precisar que você escolha entre boleto e PIX.'],
    ['Vou te transferir para o financeiro, que cuida da fatura.'],
    ['Ainda não enviei a cobrança.'],
    ['Claro, Sicrano. Como a cobrança é sua e já há um contrato identificado, posso seguir com isso. Se quiser, me peça para enviar o boleto ou o PIX da sua fatura.'],
    ['A fatura vence no dia 20.'],
    ['Um instante.'],
  ])('explicação legítima %j: não é violação', (texto) => {
    expect(violacoesDaEntrega(texto, SEM_NADA)).toEqual([]);
  });
});

describe('respostaSemEntregaSemFato', () => {
  test('tira só as frases que violam; o resto fica', () => {
    expect(respostaSemEntregaSemFato('Posso sim, Sicrano. Vou usar a fatura do endereço da Rua de Teste. Você prefere boleto ou PIX?', SEM_NADA))
      .toBe('Posso sim, Sicrano. Você prefere boleto ou PIX?');
  });
  test('sem frase útil que sobre: a frase honesta de que a cobrança não foi enviada', () => {
    expect(respostaSemEntregaSemFato('Vou usar a fatura do endereço da Rua de Teste.', SEM_NADA)).toBe(ENTREGA_NAO_FEITA);
    expect(respostaSemEntregaSemFato('Posso sim, Sicrano. Vou usar a fatura do endereço da Rua de Teste.', SEM_NADA)).toBe(`Posso sim, Sicrano. ${ENTREGA_NAO_FEITA}`);
  });
  test('sem violação, o texto não muda', () => {
    const t = 'Você quer pagar por boleto ou por PIX?';
    expect(respostaSemEntregaSemFato(t, SEM_NADA)).toBe(t);
  });
});
