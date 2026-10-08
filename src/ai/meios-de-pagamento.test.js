const { meiosDaJanela, meiosDoTurno, respostaSemOfertaDeMeioInexistente, respostaSemIndisponibilidadeNaoConfirmada, meioCitadoDepoisDaEntrega } = require('./meios-de-pagamento');

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

// Ordem do proprietário (06/10/2026, tarde): o fato é da fatura E do contrato. Com mais de um contrato na conversa, nenhuma
// frase é ligada a um contrato pelo texto (a revisão mostrou que elipse, apelido, abreviação e duas ruas na mesma frase
// tornam esse vínculo inseguro): a guarda da oferta só age quando o meio foi comprovado inexistente em TODOS os contratos, e
// a frase que não se pode vincular fica como o modelo escreveu. Dados sintéticos do SGP falso (contratos 301 e 302).
describe('mais de um contrato na conversa', () => {
  const CONTRATOS = [{ id: 301, address: 'Rua de Teste, 300' }, { id: 302, address: 'Avenida de Teste, 30' }];
  const RUA_SEM_PIX = { contratoId: '301', faturaId: '3001', pix: false, boleto: true };
  const AVENIDA_SEM_PIX = { contratoId: '302', faturaId: '3002', pix: false, boleto: true };
  const AVENIDA_SEM_BOLETO = { contratoId: '302', faturaId: '3002', pix: true, boleto: false };
  const AVENIDA_NADA = { contratoId: '302', faturaId: '3002', pix: false, boleto: false };
  const RUA_NADA = { contratoId: '301', faturaId: '3001', pix: false, boleto: false };
  const AVENIDA_PIX_FALHOU = { contratoId: '302', faturaId: '3002', pix: null, boleto: true };
  const doisContratos = { contratos: CONTRATOS };

  test('reprodução: com só a Rua comprovada sem PIX, nenhuma oferta de PIX vira o fato da Rua (o outro endereço, a elipse, a abreviação)', () => {
    for (const texto of [
      'Do outro endereço, posso gerar o PIX para você?', 'Posso gerar o PIX para você?', 'E o outro? Posso gerar o PIX dele?',
      'Da Av. de Teste, posso gerar o PIX?', 'Na Rua de Teste não tem PIX, mas posso gerar o PIX da Avenida de Teste.',
    ]) {
      expect(respostaSemOfertaDeMeioInexistente(texto, [RUA_SEM_PIX], doisContratos)).toEqual({ texto, alterado: false });
    }
  });

  test('a ausência comprovada em TODOS os contratos: a oferta sai e entra o fato, sem citar uma fatura só', () => {
    expect(respostaSemOfertaDeMeioInexistente('Posso gerar o PIX para você?', [RUA_SEM_PIX, AVENIDA_SEM_PIX], doisContratos))
      .toEqual({ texto: 'O PIX não está disponível agora em nenhuma das faturas consultadas.', alterado: true });
    expect(respostaSemOfertaDeMeioInexistente('Você pode me pedir o boleto ou o PIX novamente.', [RUA_NADA, AVENIDA_NADA], doisContratos).texto)
      .toBe('Nenhuma das faturas consultadas tem PIX nem boleto disponível por aqui agora. Se quiser, posso encaminhar você para um atendente.');
  });

  test('a oferta verdadeira do outro meio, existente em todos, é preservada junto do fato', () => {
    expect(respostaSemOfertaDeMeioInexistente('Posso te enviar o boleto e, se preferir, o PIX.', [RUA_SEM_PIX, AVENIDA_SEM_PIX], doisContratos).texto)
      .toBe('O PIX não está disponível agora em nenhuma das faturas consultadas. Se quiser, posso enviar o boleto.');
  });

  test('dois contratos com disponibilidades diferentes: nenhuma oferta é trocada, em nenhum dos dois sentidos', () => {
    const meios = [RUA_SEM_PIX, AVENIDA_SEM_BOLETO];
    for (const texto of ['Posso gerar o PIX para você?', 'Posso te enviar o boleto?', 'Da Rua de Teste, posso te enviar o boleto. Da Avenida de Teste, posso gerar o PIX.']) {
      expect(respostaSemOfertaDeMeioInexistente(texto, meios, doisContratos)).toEqual({ texto, alterado: false });
    }
  });

  test('o contrato do terceiro confirmado também conta (estado só do terceiro não vale para o contrato do cliente)', () => {
    const terceiro = { contratoId: '501', faturaId: '5001', pix: false, boleto: true };
    const texto = 'Posso gerar o PIX da sua fatura?';
    expect(respostaSemOfertaDeMeioInexistente(texto, [terceiro], { contratos: [{ id: 101 }] })).toEqual({ texto, alterado: false });
  });

  test('a indisponibilidade sem resultado em nenhum contrato: a troca não cita fatura nenhuma', () => {
    expect(respostaSemIndisponibilidadeNaoConfirmada('O PIX não está disponível agora.', [AVENIDA_PIX_FALHOU], doisContratos).texto)
      .toBe('Não consegui confirmar agora se o PIX está disponível.');
    expect(respostaSemIndisponibilidadeNaoConfirmada('O boleto não está disponível agora.', [], doisContratos).texto)
      .toBe('Não consegui confirmar agora se o boleto está disponível.');
  });

  test('com a falta comprovada em algum contrato, a afirmação não é transformada (não dá para saber de qual se fala)', () => {
    const texto = 'O PIX do outro endereço não está disponível agora.';
    expect(respostaSemIndisponibilidadeNaoConfirmada(texto, [RUA_SEM_PIX, AVENIDA_PIX_FALHOU], doisContratos)).toEqual({ texto, alterado: false });
  });

  test('com um contrato só, nada muda (mesmas frases e mesmos textos de antes)', () => {
    expect(respostaSemOfertaDeMeioInexistente('Posso gerar o PIX para você?', [RUA_SEM_PIX], { contratos: [{ id: 301 }] }).texto)
      .toBe('O PIX desta fatura não está disponível agora.');
    expect(respostaSemIndisponibilidadeNaoConfirmada('O PIX não está disponível agora.', [{ ...RUA_SEM_PIX, pix: null }], { contratos: [{ id: 301 }] }).texto)
      .toBe('Não consegui confirmar agora se o PIX está disponível para esta fatura.');
  });
});

// Rodada 10 (08/10/2026; ordem, item 2; avaliação real S5 r3, #2 e #3): a trava do meio aceitava o boleto do 301 na fala 4 (o
// cliente pediu "boleto" depois da última entrega), e o prompt não dizia isso — a regra "o meio de outra fatura não conta" fazia
// o modelo achar que faltava o meio. O fato do meio vem do histórico do turno, com a mesma régua da trava.
describe('meioCitadoDepoisDaEntrega (rodada 10, S5)', () => {
  const texto = (m) => m.content;
  const cli = (content) => ({ direction: 'inbound', messageType: 'text', content });
  const ia = (content, messageType = 'text') => ({ direction: 'outbound', sentBy: 'ai', messageType, content });
  test('S5: o boleto pedido depois da última entrega (o PDF do boleto da vizinha) é o meio da cobrança atual', () => {
    expect(meioCitadoDepoisDaEntrega([
      cli('Oi, manda o boleto da internet da minha vizinha Fulana.'), ia(null, 'document'), ia('Prontinho!'),
      cli('Agora manda o boleto da rua do João.'), ia('De quem é?'), cli('O dele.'), ia('Preciso do CPF.'), cli('Agora a minha fatura da Rua de Teste.'),
    ], texto)).toBe('boleto');
  });
  test('o meio citado só ANTES da última entrega não vale', () => {
    expect(meioCitadoDepoisDaEntrega([cli('manda o boleto'), ia(null, 'document'), cli('agora a da outra casa')], texto)).toBe(null);
  });
  test('o cartão PIX também é entrega', () => {
    expect(meioCitadoDepoisDaEntrega([cli('manda o pix'), ia('PIX-DE-TESTE', 'pix'), cli('e o boleto da outra?')], texto)).toBe('boleto');
  });
  test('sem entrega no histórico, vale o meio citado em qualquer fala dele', () => {
    expect(meioCitadoDepoisDaEntrega([cli('quero pagar por pix'), ia('De qual endereço?'), cli('da Rua de Teste')], texto)).toBe('pix');
  });
  test('os dois meios, só a negação, ou só a fala da IA: nenhum', () => {
    expect(meioCitadoDepoisDaEntrega([cli('boleto ou pix, tanto faz')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('não quero boleto')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('não quero boleto, manda o pix')], texto)).toBe('pix');
    expect(meioCitadoDepoisDaEntrega([ia('Você prefere boleto ou PIX?'), cli('o primeiro')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([], texto)).toBe(null);
  });
});

// Revisão da rodada 10 (A4-1 e A4-2, verificados por script).
describe('meioCitadoDepoisDaEntrega: correções da revisão da rodada 10', () => {
  const texto = (m) => m.content;
  const cli = (content) => ({ direction: 'inbound', messageType: 'text', content });
  const ia = (content, meiosDaFatura) => ({ direction: 'outbound', sentBy: 'ai', messageType: 'text', content, metadata: { meiosDaFatura } });
  test('A4-1: a desistência não cita meio e apaga o citado antes', () => {
    expect(meioCitadoDepoisDaEntrega([cli('manda o pix'), cli('esquece o pix')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('cancela o boleto')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('manda o pix'), cli('esquece')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('não precisa mais o boleto')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('manda o pix não')], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('esquece o pix, manda o boleto')], texto)).toBe('boleto');
    expect(meioCitadoDepoisDaEntrega([cli('não quero boleto, manda o pix')], texto)).toBe('pix');
    // A oração com "não" que não é desistência também não cita ("o boleto não chegou" não é pedido de boleto).
    expect(meioCitadoDepoisDaEntrega([cli('o boleto não chegou')], texto)).toBe(null);
  });
  test('A4-2: o meio que a 2ª via desta conversa mostrou inexistente não vira fato', () => {
    expect(meioCitadoDepoisDaEntrega([cli('manda o pix'), ia('Essa fatura não tem PIX agora.', [{ contratoId: '301', faturaId: '9', pix: false, boleto: true }])], texto)).toBe(null);
    expect(meioCitadoDepoisDaEntrega([cli('manda o pix'), ia('Você prefere boleto ou PIX?', [{ contratoId: '301', faturaId: '9', pix: true, boleto: true }])], texto)).toBe('pix');
  });
});
