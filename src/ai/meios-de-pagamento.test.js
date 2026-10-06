const { meiosDaJanela, meiosDoTurno, respostaSemOfertaDeMeioInexistente, respostaSemIndisponibilidadeNaoConfirmada } = require('./meios-de-pagamento');

// Comportamento da IA (06/10/2026; A6/A7): o estado dos meios que a 2ª via desta conversa comprovou e as duas guardas da
// resposta restritas a ele — sem ampliar o validador de promessas.
const NADA = [{ contratoId: '17402', faturaId: '9', pix: false, boleto: false }];
const SEM_PIX = [{ contratoId: '17402', faturaId: '9', pix: false, boleto: true }];
const PIX_FALHOU = [{ contratoId: '17402', faturaId: '9', pix: null, boleto: true }];
const OS_DOIS = [{ contratoId: '17402', faturaId: '9', pix: true, boleto: true }];

describe('estado dos meios da fatura', () => {
  test('a janela dá o estado da resposta da IA mais recente que o traz (inclusive vazio)', () => {
    expect(meiosDaJanela([
      { de: 'ia', texto: 'a', meiosDaFatura: NADA }, { de: 'cliente', texto: 'b' }, { de: 'ia', texto: 'c' }, { de: 'cliente', texto: 'd' },
    ])).toEqual(NADA);
    expect(meiosDaJanela([{ de: 'ia', texto: 'a', meiosDaFatura: NADA }, { de: 'ia', texto: 'c', meiosDaFatura: [] }])).toEqual([]);
    expect(meiosDaJanela(null)).toEqual([]);
  });

  test('o turno usa o que ele mesmo gravou; sem isso, o herdado da janela', () => {
    expect(meiosDoTurno({ meiosDaFatura: OS_DOIS, mensagensDaJanela: [{ de: 'ia', meiosDaFatura: NADA }] })).toEqual(OS_DOIS);
    expect(meiosDoTurno({ mensagensDaJanela: [{ de: 'ia', meiosDaFatura: NADA }] })).toEqual(NADA);
  });
});

describe('oferta de meio que a 2ª via mostrou inexistente', () => {
  // Reprodução da avaliação real de 06/10 (E6 #2, fala 2): PIX e boleto inexistentes, e a resposta convidou a pedir de novo.
  test('E6 #2 reprovado: a oferta sai e entra o fato comprovado com o único próximo passo que existe', () => {
    const r = respostaSemOfertaDeMeioInexistente('Você pode me pedir o boleto ou o PIX novamente, e eu verifico para te enviar se houver opção disponível.', NADA);
    expect(r.alterado).toBe(true);
    expect(r.texto).toBe('Esta fatura não tem PIX nem boleto disponível por aqui agora. Se quiser, posso encaminhar você para um atendente.');
  });

  test.each([
    ['a explicação honesta (E6 #1 aprovado)', 'Essa fatura não tem PIX disponível agora e também não consigo enviar boleto dela por aqui neste momento. Não há outra forma de pagamento para oferecer por aqui agora. Se quiser, posso encaminhar você para um atendente.', NADA],
    ['o encaminhamento confirmado (E6 #3 aprovado)', 'Certo! Seu atendimento entrou na fila do setor Financeiro e um atendente vai responder por aqui assim que estiver disponível.', NADA],
    ['a oferta do meio que existe', 'Esta fatura não tem PIX agora. Posso enviar o boleto desta mesma fatura?', SEM_PIX],
    ['a confirmação da entrega', 'Prontinho! Enviei acima o boleto em PDF. É só pagar pelo aplicativo do seu banco, copiando a linha digitável, ou em qualquer lotérica.', OS_DOIS],
    ['a pergunta sem nada comprovado', 'Você quer pagar por boleto ou por PIX? Assim que você escolher, eu vejo se ele está disponível para esta fatura.', []],
  ])('%s: fica como está', (_nome, texto, meios) => {
    expect(respostaSemOfertaDeMeioInexistente(texto, meios)).toEqual({ texto, alterado: false });
  });

  test('a negação com "novamente" não é oferta: fica', () => {
    const texto = 'Tentei novamente e o PIX desta fatura não está disponível.';
    expect(respostaSemOfertaDeMeioInexistente(texto, SEM_PIX)).toEqual({ texto, alterado: false });
  });

  test('só o PIX inexistente: a oferta do PIX sai, o resto fica, e entra o fato do PIX', () => {
    const r = respostaSemOfertaDeMeioInexistente('Entendi! Posso gerar o PIX para você agora?', SEM_PIX);
    expect(r).toEqual({ texto: 'Entendi! O PIX desta fatura não está disponível agora.', alterado: true });
  });

  test('a oferta de um meio inexistente numa fatura e existente noutra: nada muda (não dá para saber de qual se fala)', () => {
    const duas = [...SEM_PIX, { contratoId: '17402', faturaId: '10', pix: true, boleto: true }];
    expect(respostaSemOfertaDeMeioInexistente('Posso gerar o PIX para você agora?', duas).alterado).toBe(false);
  });

  // Revisão de A6/A7 (06/10/2026, I1): o fato do PIX inexistente e a oferta do boleto na MESMA frase — a oferta é do boleto,
  // não do PIX. A guarda olha a oração e o objeto da oferta, não a frase inteira.
  test.each([
    'Essa fatura está sem código PIX no momento, mas posso te enviar o boleto dela.',
    'Não consegui gerar o PIX desta fatura, mas posso te enviar o boleto.',
    'Não tenho PIX para esta fatura; posso enviar o boleto?',
    'O PIX não foi gerado para essa fatura, mas posso te mandar o boleto, tudo bem?',
    'Em vez do PIX, posso te enviar o boleto desta fatura.',
    'Posso te enviar o boleto, já que o PIX não está disponível.',
    'Posso te enviar o boleto em vez do PIX.',
    'Posso te mandar o boleto, já que está sem PIX.',
  ])('"%s": fica como está (o PIX não é o que se oferece)', (texto) => {
    expect(respostaSemOfertaDeMeioInexistente(texto, SEM_PIX)).toEqual({ texto, alterado: false });
  });

  test('o convite a pedir de novo sem nomear o meio, logo depois do PIX inexistente, é convite ao PIX: sai', () => {
    expect(respostaSemOfertaDeMeioInexistente('Essa fatura não tem PIX, mas você pode pedir de novo depois.', SEM_PIX))
      .toEqual({ texto: 'O PIX desta fatura não está disponível agora.', alterado: true });
  });

  test('a oferta dos dois meios sai, e a oferta verdadeira do boleto que ela trazia volta junto do fato', () => {
    const fatoComBoleto = 'O PIX desta fatura não está disponível agora. Se quiser, posso enviar o boleto dela.';
    expect(respostaSemOfertaDeMeioInexistente('Posso te enviar o boleto e, se preferir, o PIX.', SEM_PIX)).toEqual({ texto: fatoComBoleto, alterado: true });
    expect(respostaSemOfertaDeMeioInexistente('Prefere boleto ou PIX?', SEM_PIX).texto).toBe(fatoComBoleto);
    expect(respostaSemOfertaDeMeioInexistente('Essa fatura não tem PIX disponível. Prefere boleto ou PIX?', SEM_PIX).texto)
      .toBe('Essa fatura não tem PIX disponível. Se quiser, posso enviar o boleto dela.');
  });

  test('a pergunta da escolha com um meio inexistente sai inteira, com a frase que depende dela', () => {
    expect(respostaSemOfertaDeMeioInexistente('Você quer pagar por boleto ou por PIX? Assim que você escolher, eu vejo se ele está disponível para esta fatura.', SEM_PIX).texto)
      .toBe('O PIX desta fatura não está disponível agora. Se quiser, posso enviar o boleto dela.');
  });

  test('a oferta no subjuntivo ("quer que eu envie o PIX?") também é oferta', () => {
    expect(respostaSemOfertaDeMeioInexistente('Quer que eu envie o PIX?', SEM_PIX)).toEqual({ texto: 'O PIX desta fatura não está disponível agora.', alterado: true });
  });
});

describe('indisponibilidade afirmada sem resultado', () => {
  test('o pedido do PIX falhou (estado desconhecido): "não há PIX" sai e entra que não deu para confirmar', () => {
    const r = respostaSemIndisponibilidadeNaoConfirmada('Não há código PIX disponível para essa fatura agora. Se quiser, posso te enviar o boleto.', PIX_FALHOU, {});
    expect(r).toEqual({ texto: 'Não consegui confirmar agora se o PIX está disponível para esta fatura. Se quiser, posso te enviar o boleto.', alterado: true });
  });

  test('sem nenhum resultado no turno nem na conversa, a afirmação também sai', () => {
    expect(respostaSemIndisponibilidadeNaoConfirmada('O boleto desta fatura não está disponível agora.', [], {}).texto)
      .toBe('Não consegui confirmar agora se o boleto está disponível para esta fatura.');
  });

  test.each([
    ['indisponibilidade comprovada pela 2ª via', 'Não há código PIX disponível para essa fatura agora.', SEM_PIX, {}],
    ['a ferramenta respondeu outra coisa (bloqueio, sem fatura): a instrução dela vale', 'O boleto não está disponível por aqui para este caso.', [], { cobrancaComResposta: true }],
    ['a falha dita como falha', 'Não consegui gerar o PIX agora. Você pode pedir de novo daqui a pouco.', PIX_FALHOU, {}],
    ['outro assunto ("não tem boleto em aberto")', 'Você não tem boleto em aberto neste contrato.', [], {}],
    // Revisão de A6/A7 (06/10/2026, I3): "não consigo enviar/gerar" com outro motivo não é disponibilidade.
    ['a recusa até saber de quem é a fatura', 'Não consigo enviar o boleto antes de saber de quem é a fatura: é sua ou de outra pessoa?', [], {}],
    ['o pedido do CPF do titular', 'Não consigo gerar o PIX sem o CPF do titular, pode me informar?', [], {}],
    ['o pedido do CPF com o PIX que falhou', 'Não consigo gerar o PIX sem o CPF do titular, pode me informar?', PIX_FALHOU, {}],
  ])('%s: fica como está', (_nome, texto, meios, sinais) => {
    expect(respostaSemIndisponibilidadeNaoConfirmada(texto, meios, sinais)).toEqual({ texto, alterado: false });
  });
});
