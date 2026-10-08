const { violacoesDaEntrega, respostaSemEntregaSemFato, ENTREGA_NAO_FEITA, NADA_NOVO_ENVIADO, correcaoDaEntrega } = require('./anuncio-de-entrega');

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

// Revisão da rodada 10 (achados A3-1 a A3-5, verificados por script).
describe('G1: correções da revisão da rodada 10', () => {
  test.each([
    ['Não se preocupe, vou enviar o boleto agora.'], ['Não tem problema, vou gerar o PIX para você.'],
    ['Você não precisa fazer nada, vou providenciar o boleto.'], ['Poxa, como o boleto não chegou, vou te enviar de novo.'],
  ])('A3-1: o "não" de OUTRA oração não nega o anúncio — %j', (texto) => {
    expect(violacoesDaEntrega(texto, SEM_NADA)).toContain('entrega_futura');
  });
  test('A3-1: o "não" de outra oração também não nega a afirmação de entrega feita', () => {
    expect(violacoesDaEntrega('Não se preocupe, enviei o boleto acima.', SEM_NADA)).toContain('entrega_concluida');
  });
  test.each([['O boleto não foi enviado.'], ['Ainda não enviei a cobrança.'], ['Não vou mandar o boleto sem o seu pedido.'], ['Eu não vou conseguir enviar o PIX agora.']])(
    'A3-1 (preservado): a negação colada ao verbo, na mesma oração — %j', (texto) => {
      expect(violacoesDaEntrega(texto, SEM_NADA)).toEqual([]);
    },
  );
  test.each([
    ['Vou te explicar: o boleto vence no dia 20.'], ['Vamos lá: a fatura está em aberto, R$ 99,90.'], ['Pague e em seguida me envie o comprovante do PIX.'],
    ['Obrigado! Aguarde a compensação do PIX, que pode levar alguns minutos.'], ['Vou te explicar como pagar o boleto pelo aplicativo.'],
  ])('A3-2/A3-3: explicação legítima — %j', (texto) => {
    expect(violacoesDaEntrega(texto, SEM_NADA)).toEqual([]);
    expect(violacoesDaEntrega(texto, COM_ANTERIOR)).toEqual([]);
  });
  test('A3-2: com entrega anterior na conversa, a frase honesta não diz que nunca enviou', () => {
    expect(respostaSemEntregaSemFato('Vou usar a fatura da Rua de Teste.', COM_ANTERIOR)).toBe(NADA_NOVO_ENVIADO);
    expect(NADA_NOVO_ENVIADO).not.toMatch(/ainda não enviei/i);
    expect(respostaSemEntregaSemFato('Vou usar a fatura da Rua de Teste.', SEM_NADA)).toBe(ENTREGA_NAO_FEITA);
  });
  test('A3-4: a afirmação de entrega feita numa frase que termina em pergunta continua sendo afirmação', () => {
    expect(violacoesDaEntrega('Enviei o boleto acima, conseguiu abrir?', SEM_NADA)).toContain('entrega_concluida');
    expect(violacoesDaEntrega('Quer que eu reenvie o boleto?', SEM_NADA)).toEqual([]);
  });
  test('A3-5: no turno do limite de perguntas, a correção não manda perguntar', () => {
    expect(correcaoDaEntrega({})).toMatch(/pergunte só o que falta/);
    const ultima = correcaoDaEntrega({ forcarConclusao: true });
    expect(ultima).not.toMatch(/pergunte/);
    expect(ultima).toMatch(/concluir_triagem/);
  });
});

// Revisão da rodada 10: o gerúndio só conta com verbo de entrega; e o objeto implícito, com verbo de entrega, conta.
test('G1: "estou vendo" é explicação; "estou gerando" e "vou te enviar de novo" (o boleto citado antes) são trabalho em andamento', () => {
  expect(violacoesDaEntrega('Estou vendo aqui que a fatura vence dia 20.', SEM_NADA)).toEqual([]);
  expect(violacoesDaEntrega('Já estou gerando o seu PIX.', SEM_NADA)).toContain('entrega_futura');
  expect(violacoesDaEntrega('Poxa, como o boleto não chegou, vou te enviar de novo.', SEM_NADA)).toContain('entrega_futura');
});

// Revisão do incremento da rodada 10 (R2 e R3, verificados por script): todas as ocorrências de cada forma são conferidas, e a
// negação colada só aceita palavras auxiliares entre o "não" e o verbo.
describe('G1: ressalvas da revisão do incremento', () => {
  test.each([
    ['Não vou mandar o PIX, vou mandar o boleto agora.'], ['Não se preocupe vou enviar o boleto agora.'],
    ['Vou falar com o financeiro e já vou te enviar o boleto.'], ['Daqui a pouco o boleto chega no seu WhatsApp.'],
    ['Estou reenviando o boleto agora.'], ['Aguarde, o boleto está sendo gerado.'],
  ])('%j apresenta a entrega que não saiu como trabalho em andamento', (texto) => {
    expect(violacoesDaEntrega(texto, SEM_NADA)).toContain('entrega_futura');
  });
  test.each([['Eu não vou conseguir enviar o PIX agora.'], ['Ainda não enviei a cobrança.'], ['Não te mandei o boleto ainda.'], ['O boleto ainda não foi gerado.']])(
    'a negação com auxiliares continua negando — %j', (texto) => {
      expect(violacoesDaEntrega(texto, SEM_NADA)).toEqual([]);
    },
  );
});
