const { intencaoDeAlvo, resolverAlvoDoTurno, resolverAlvoDasMensagens, fixarAlvoTerceiro, documentosValidos } = require('./financial-target');

// Formas do resultado de resolverAlvoDoTurno. `alvoPendente` é a dúvida que o worker grava no escopo
// persistido ao fim do turno (null = nenhuma): é ela que faz a trava sobreviver aos turnos.
const titular = { terceiro: null, voltarAoTitular: false, alvoAmbiguo: false, alvoPendente: null };
const volta = { terceiro: null, voltarAoTitular: true, alvoAmbiguo: false, alvoPendente: null };
const segue = (terceiro) => ({ terceiro, voltarAoTitular: false, alvoAmbiguo: false, alvoPendente: null });
const trava = (terceiro, motivo, pendente = motivo) => ({ terceiro, voltarAoTitular: false, alvoAmbiguo: motivo, alvoPendente: pendente });

// Caso Fulana/Beltrana (25/09/2026): o alvo de TERCEIRO é "grudento". Só uma intenção EXPLÍCITA na
// mensagem do cliente muda o alvo — lida em código, por palavras inteiras, sem OpenAI.
describe('intencaoDeAlvo', () => {
  test.each([
    'agora quero minha fatura', 'manda o meu pix', 'meu boleto', 'agora o meu', 'e a minha também?',
    'Agora manda o MEU PIX!', 'quero a minha segunda via',
  ])('própria: "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('proprio');
  });

  test.each([
    'manda o dela', 'o boleto dele', 'manda o pix da Beltrana', 'o da beltrana também', 'a fatura do meu marido',
    'o boleto da minha mãe', 'da outra pessoa',
  ])('de terceiro: "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('terceiro');
  });

  test.each([
    'manda o meu e o dela', 'o meu marido quer o boleto dele e o meu', 'a minha e a da Beltrana',
  ])('ambígua (os dois lados): "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('ambiguo');
  });

  test.each(['manda o pix', 'manda o boleto também', 'pode mandar', 'ok', 'obrigada', '', null])('sem alvo explícito: %p', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBeNull();
  });

  test('"da minha mãe" não é "a minha": palavra inteira, não pedaço', () => {
    expect(intencaoDeAlvo('manda o boleto da minha mãe', null)).toBe('terceiro');
  });
});

describe('resolverAlvoDoTurno', () => {
  const BELTRANA = { nome: 'Beltrana', contratos: [{ id: 2002 }] };

  test('terceiro ativo + pedido sem alvo explícito: continua o terceiro (grudento)', () => {
    expect(resolverAlvoDoTurno({ terceiro: BELTRANA, texto: 'manda o boleto também' })).toEqual(segue(BELTRANA));
  });

  test('terceiro ativo + "agora quero minha fatura": volta ao titular, sem pedir CPF', () => {
    expect(resolverAlvoDoTurno({ terceiro: BELTRANA, texto: 'agora quero minha fatura' })).toEqual(volta);
  });

  test('terceiro ativo + intenção dos dois lados: nada de cobrança até esclarecer', () => {
    expect(resolverAlvoDoTurno({ terceiro: BELTRANA, texto: 'manda o meu e o dela' })).toEqual(trava(BELTRANA, 'dois_lados'));
  });

  test('sem terceiro + cliente fala de outra pessoa sem CPF: nada de cobrança do titular até esclarecer', () => {
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o boleto da minha mãe' })).toEqual(trava(null, 'outra_pessoa_sem_documento'));
  });

  test('sem terceiro + pedido do próprio ou sem alvo: segue o titular', () => {
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o pix' })).toEqual(titular);
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'meu boleto' })).toEqual(titular);
  });

  test('terceiro PENDENTE (CPF não encontrado) + "manda o pix": continua pendente, não volta ao titular', () => {
    const pendente = { nome: null, contratos: [], pendente: true };
    expect(resolverAlvoDoTurno({ terceiro: pendente, texto: 'manda o pix' })).toEqual(segue(pendente));
  });
});

test('um terceiro consultado resolve a ambiguidade do turno', () => {
  const contexto = { alvoAmbiguo: true };
  fixarAlvoTerceiro(contexto, [{ id: 2002 }]);
  expect(contexto.alvoAmbiguo).toBe(false);
  expect(contexto.alvoTerceiro).toEqual({ contratos: [2002] });
});

// F2 (30/09/2026; casos C01 e C08 do diagnóstico de 29/09): "da minha" e "do meu" contavam como terceiro
// fosse qual fosse o complemento — "o boleto da minha internet" travava a cobrança do próprio cliente.
// Agora quem decide é o que vem DEPOIS do possessivo: cobrança do cliente, ou serviço dele num pedido, é
// do próprio; pessoa é outra pessoa; complemento desconhecido ou ausente depois de "da/do" não decide
// nada — e não cai no contrato principal: trava a cobrança do turno até esclarecer.
describe('F2 — o complemento do possessivo decide', () => {
  test.each([
    'quero pagar o boleto da minha internet', 'manda o pix da minha net', 'me manda a segunda via do meu contrato',
    'quero a liberação da minha net pra min poder pagar', 'quero pagar a conta da minha casa', 'o boleto do meu plano',
    'a fatura da minha conexão',
  ])('próprio: "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('proprio');
  });

  test.each([
    'manda o boleto da minha mãe', 'quero o pix do meu marido', 'a fatura da minha sogra', 'o boleto do meu cunhado',
    'manda a fatura dela', 'o boleto no nome da minha mãe', 'manda o da outra pessoa',
  ])('outra pessoa: "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('terceiro');
  });

  // "outro" + coisa do atendimento não é outra pessoa (o defeito de "da minha", em "do outro") nem volta ao
  // titular: com terceiro registrado, "manda o outro boleto" pode ser a outra fatura DELE.
  test.each(['manda o boleto do outro contrato', 'manda o outro boleto', 'a outra fatura'])(
    '"outro" + coisa do atendimento ("%s"): não decide o alvo', (texto) => {
      const beltrana = { nome: 'Beltrana', contratos: [{ id: 2002 }] };
      expect(intencaoDeAlvo(texto, 'Beltrana')).toBeNull();
      expect(resolverAlvoDoTurno({ terceiro: beltrana, texto })).toEqual(segue(beltrana));
    },
  );

  // Com artigo antes do possessivo, a pessoa continua sendo pessoa: "a minha mãe" não é o pronome "a minha".
  test.each(['a minha mãe pediu o boleto', 'o meu marido quer o pix'])('artigo + possessivo + pessoa ("%s"): outra pessoa', (texto) => {
    const beltrana = { nome: 'Beltrana', contratos: [{ id: 2002 }] };
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('terceiro');
    expect(resolverAlvoDoTurno({ terceiro: beltrana, texto })).toEqual(trava(beltrana, 'terceiro_nao_vinculado'));
  });

  test.each(['manda o da minha', 'é do meu', 'o boleto da minha loja', 'o pix do meu negócio'])(
    'complemento ausente ou desconhecido depois de "da/do": "%s" não decide o alvo', (texto) => {
      expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('indefinido');
    },
  );

  test.each([
    'o boleto da minha mãe e o da minha internet', 'manda o meu e o da minha mãe', 'o da minha casa e o dela',
    'o meu e o da minha',
  ])('dos dois lados: "%s"', (texto) => {
    expect(intencaoDeAlvo(texto, 'Beltrana')).toBe('ambiguo');
  });
});

describe('F2 — alvo do turno sem terceiro registrado', () => {
  test.each(['quero pagar o boleto da minha internet', 'me manda a segunda via do meu contrato', 'quero pagar a conta da minha casa'])(
    'pedido próprio com possessivo ("%s"): segue o titular, a cobrança dele não trava', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: null, texto })).toEqual(titular);
    },
  );

  // A dúvida de outra pessoa sem documento passa a ser gravada (escopo pendente, sem contrato): o próximo
  // "pode mandar" não devolve a cobrança do titular.
  test.each(['manda o boleto da minha mãe', 'quero o pix do meu marido', 'manda a fatura dela'])(
    'outra pessoa sem documento ("%s"): nada do titular sai até esclarecer, e a dúvida é gravada', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: null, texto })).toEqual(trava(null, 'outra_pessoa_sem_documento'));
    },
  );

  test('fragmento incompleto não cai no contrato principal: trava o turno (sem gravar: pode ser do próprio)', () => {
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o boleto da minha' })).toEqual(trava(null, 'referencia_incompleta', null));
  });

  test('dos dois lados: trava o turno', () => {
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'o boleto da minha mãe e o da minha internet' })).toEqual(trava(null, 'dois_lados', null));
  });
});

describe('F2 — alvo do turno com terceiro registrado (grudento)', () => {
  const FULANA = { nome: 'Fulana', contratos: [{ id: 401 }] };

  test.each(['boleto também', 'manda o PIX', 'pode mandar', 'manda o dela', 'o da Fulana'])(
    'sem alvo novo ("%s"): continua o mesmo terceiro', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(segue(FULANA));
    },
  );

  test.each(['manda o boleto da minha internet', 'agora o pix da minha net', 'a segunda via do meu contrato'])(
    'retorno explícito ao próprio ("%s"): volta ao titular (regra de 25/09)', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(volta);
    },
  );

  test('fragmento incompleto não muda o alvo nem autoriza nada: trava, o terceiro fica, a dúvida é gravada', () => {
    expect(resolverAlvoDoTurno({ terceiro: FULANA, texto: 'manda o da minha' })).toEqual(trava(FULANA, 'referencia_incompleta'));
  });

  test('próprio e terceiro na mesma mensagem: trava, e nada volta ao titular', () => {
    expect(resolverAlvoDoTurno({ terceiro: FULANA, texto: 'manda o da minha internet e o dela' })).toEqual(trava(FULANA, 'dois_lados'));
  });

  // Possível NOVO terceiro (decisão 4 do gerente): nada prova que "minha mãe" é a Fulana. Nenhuma
  // cobrança sai — nem da Fulana, nem de quem fala — e o escopo registrado não é apagado.
  test.each(['manda o boleto da minha mãe', 'agora o pix do meu marido', 'o boleto da minha mãe Fulana'])(
    'pessoa nova que não dá para ligar ao terceiro registrado ("%s"): trava, sem apagar nada', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(trava(FULANA, 'terceiro_nao_vinculado'));
    },
  );

  test('terceiro PENDENTE (documento não encontrado) + pedido próprio explícito: volta ao titular', () => {
    const pendente = { nome: null, contratos: [], pendente: true };
    expect(resolverAlvoDoTurno({ terceiro: pendente, texto: 'então manda o boleto da minha internet' })).toEqual(volta);
  });
});

// Revisão gerencial da F2 (30/09/2026). Quatro falhas reproduzidas com terceiro válido registrado:
// "vou pagar com o meu cartão" e "não quero a minha fatura" voltavam ao titular; "agora é de outra pessoa"
// mantinha o terceiro anterior; e a trava da pessoa nova dependia de a fala ainda estar nas 20 mensagens
// lidas. As decisões corrigidas: voltar ao próprio exige dizer, afirmativamente, que a COBRANÇA pedida é
// dele; meio de pagamento e quem paga não são titular; pessoa diferente, com ou sem parentesco, pede um
// novo alvo; a dúvida fica gravada no escopo, não no histórico.
describe('revisão da F2 — segurança do alvo', () => {
  const FULANA = { nome: 'Fulana', contratos: [{ id: 401 }] };

  describe('meio de pagamento e quem paga não são o titular da cobrança', () => {
    test.each([
      'vou pagar com o meu cartão', 'pago pelo meu aplicativo', 'vou transferir pela minha conta do banco',
      'vou pagar com o cartão da minha mãe', 'a minha mãe vai pagar', 'quem vai pagar é o meu marido',
      'vou pagar com o cartão dela',
    ])('terceiro registrado + "%s": continua o terceiro — nem volta ao titular, nem pessoa nova', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(segue(FULANA));
    });

    test.each(['vou pagar com o cartão da minha mãe', 'quem vai pagar é o meu marido'])(
      'sem terceiro + "%s": quem paga não vira terceiro — segue o titular', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: null, texto })).toEqual(titular);
      },
    );

    test('a minha mãe paga o MEU boleto: a cobrança é do próprio', () => {
      expect(resolverAlvoDoTurno({ terceiro: null, texto: 'a minha mãe vai pagar o meu boleto' })).toEqual(titular);
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto: 'a minha mãe vai pagar o meu boleto' })).toEqual(volta);
    });
  });

  describe('própria cobrança só com afirmação clara', () => {
    test.each([
      'não quero a minha fatura', 'não é o meu boleto', 'não recebi meu boleto', 'nunca pedi a minha segunda via',
      'o boleto no meu nome', 'meu cpf é esse mesmo', 'o meu cartão foi recusado', 'minha internet caiu',
    ])('terceiro registrado + "%s": não limpa o terceiro — trava e grava a dúvida', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(trava(FULANA, 'proprio_nao_afirmado'));
    });

    // Menção ao próprio junto com um apontamento claro para o terceiro registrado, sem negação: o pedido é dele.
    test.each(['minha internet caiu, manda o dela', 'o meu cpf é outro, manda o da Fulana'])(
      'terceiro registrado + "%s": continua o terceiro', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(segue(FULANA));
      },
    );

    // Destinatário não é titular: "pra mim" diz para quem mandar, não de quem é a cobrança.
    test.each(['manda o pix pra mim', 'manda o boleto dela pra mim'])('terceiro registrado + "%s": continua o terceiro', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(segue(FULANA));
    });

    test.each(['não recebi meu boleto', 'o boleto no meu nome', 'manda o pix pra mim'])(
      'sem terceiro + "%s": segue o titular (a menção não trava quem já é o alvo)', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: null, texto })).toEqual(titular);
      },
    );

    test.each([
      'manda a minha fatura', 'agora o meu boleto', 'quero a segunda via do meu contrato', 'agora o meu', 'e a minha também?',
      'vou pagar a minha fatura com o meu cartão',
    ])('terceiro registrado + "%s": volta ao titular', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(volta);
    });
  });

  describe('pessoa diferente, com ou sem parentesco, não continua o terceiro anterior', () => {
    test.each(['agora é de outra pessoa', 'é de outro cliente', 'manda o da outra pessoa', 'o boleto da Beltrana'])(
      'terceiro registrado + "%s": trava e grava a pessoa nova', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(trava(FULANA, 'terceiro_nao_vinculado'));
      },
    );

    test('nome com inicial maiúscula, sem terceiro registrado: outra pessoa — nada do titular sai', () => {
      expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o boleto da Beltrana' })).toEqual(trava(null, 'outra_pessoa_sem_documento'));
    });

    // Partícula de sobrenome não é posse: o próprio nome do cliente ("Fulana de Tal Exemplo", "Maria da
    // Silva") não pode virar outra pessoa — é a resposta da F1 ao pedido do documento.
    test.each(['Fulana de Tal Exemplo', 'meu nome é Maria da Silva', 'sou a Joana dos Santos'])(
      'nome com partícula ("%s") não é pessoa diferente', (texto) => {
        expect(['indefinido', null]).toContain(intencaoDeAlvo(texto, null));
        expect(resolverAlvoDoTurno({ terceiro: null, texto })).toEqual(titular);
      },
    );

    test.each(['é da Beltrana', 'o da Beltrana', 'quero pagar a fatura do Sicrano'])('"%s": nome depois de cobrança, artigo ou "é" é pessoa diferente', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(trava(FULANA, 'terceiro_nao_vinculado'));
    });

    test('o nome do terceiro registrado continua sendo ele; mês com maiúscula não é pessoa', () => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto: 'o boleto da Fulana' })).toEqual(segue(FULANA));
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto: 'o boleto de Setembro' })).toEqual(segue(FULANA));
    });
  });

  // A dúvida gravada no escopo (alvoPendente) é o que sustenta a trava nos turnos seguintes — não o
  // histórico lido. O worker a carrega do banco a cada turno, inclusive depois de reiniciar.
  describe('dúvida gravada no escopo', () => {
    const naoVinculado = { ...FULANA, alvoPendente: 'terceiro_nao_vinculado' };

    test.each(['pode mandar', 'sim', 'não', 'é outra', 'manda o dela', 'é a Fulana mesmo', 'boleto também'])(
      'pessoa nova gravada + "%s": continua travado (só documento, volta explícita ou prazo resolvem)', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: naoVinculado, texto })).toEqual(trava(naoVinculado, 'terceiro_nao_vinculado'));
      },
    );

    test('pessoa nova gravada + volta explícita ao próprio: volta ao titular', () => {
      expect(resolverAlvoDoTurno({ terceiro: naoVinculado, texto: 'quero a minha fatura' })).toEqual(volta);
    });

    test.each(['referencia_incompleta', 'dois_lados', 'proprio_nao_afirmado'])(
      'dúvida "%s" gravada: se resolve ao apontar para o terceiro registrado ("o dela", o nome)', (motivo) => {
        const comDuvida = { ...FULANA, alvoPendente: motivo };
        expect(resolverAlvoDoTurno({ terceiro: comDuvida, texto: 'manda o dela' })).toEqual(segue(comDuvida));
        expect(resolverAlvoDoTurno({ terceiro: comDuvida, texto: 'o da Fulana' })).toEqual(segue(comDuvida));
        expect(resolverAlvoDoTurno({ terceiro: comDuvida, texto: 'pode mandar' })).toEqual(trava(comDuvida, motivo));
        expect(resolverAlvoDoTurno({ terceiro: comDuvida, texto: 'não é o da Fulana' })).toEqual(trava(comDuvida, 'terceiro_nao_vinculado'));
      },
    );

    test('dúvida fraca gravada + pessoa nova: passa a ser a trava forte', () => {
      const comDuvida = { ...FULANA, alvoPendente: 'referencia_incompleta' };
      expect(resolverAlvoDoTurno({ terceiro: comDuvida, texto: 'é da minha mãe' })).toEqual(trava(comDuvida, 'terceiro_nao_vinculado'));
    });

    test('pendência sem terceiro (outra pessoa sem documento) gravada: "pode mandar" não devolve o titular', () => {
      const pendente = { nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' };
      expect(resolverAlvoDoTurno({ terceiro: pendente, texto: 'pode mandar' })).toEqual(trava(pendente, 'outra_pessoa_sem_documento'));
      expect(resolverAlvoDoTurno({ terceiro: pendente, texto: 'manda o dela' })).toEqual(trava(pendente, 'outra_pessoa_sem_documento'));
      expect(resolverAlvoDoTurno({ terceiro: pendente, texto: 'na verdade é a minha fatura' })).toEqual(volta);
    });
  });
});

// Segunda revisão gerencial da F2 (30/09/2026). A maiúscula decidia ("da Beltrana" travava, "da beltrana"
// seguia a Fulana) e negar o alvo atual o reafirmava ("não é da Fulana" seguia a Fulana). Agora uma
// referência de titularidade que não se resolve — depois de cobrança, artigo ou "é" — trava, em qualquer
// grafia; a negação vale para a referência negada, na oração em que aparece.
describe('segunda revisão da F2 — referência e negação', () => {
  const FULANA = { nome: 'Fulana', contratos: [{ id: 401 }] };

  describe('a grafia não decide', () => {
    test.each([
      ['manda o boleto da Beltrana', 'manda o boleto da beltrana'], ['o da Beltrana', 'o da beltrana'],
      ['é da BELTRANA', 'é da beltrana'], ['quero pagar a fatura do Sicrano', 'quero pagar a fatura do sicrano'],
    ])('"%s" e "%s": o mesmo resultado — com terceiro trava forte, sem terceiro trava e grava', (maiuscula, minuscula) => {
      for (const texto of [maiuscula, minuscula]) {
        expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(trava(FULANA, 'terceiro_nao_vinculado'));
        expect(resolverAlvoDoTurno({ terceiro: null, texto })).toEqual(trava(null, 'outra_pessoa_sem_documento'));
      }
    });

    test.each(['o boleto da Fulana', 'o boleto da fulana', 'O BOLETO DA FULANA'])('"%s": o nome do terceiro registrado continua nele', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(segue(FULANA));
    });
  });

  describe('complementos que não indicam pessoa continuam valendo', () => {
    test.each([
      'manda o boleto do mês', 'o boleto de setembro', 'o boleto de Setembro', 'a segunda via da fatura',
      'o boleto do vencimento dia 10', 'o pix da mensalidade', 'manda o boleto de novo', 'o boleto do mês passado',
      'o boleto de 89 reais', 'o boleto da semana passada', 'o boleto da internet', 'o pix do valor total',
      'o boleto de hoje', 'o pix do código de barras',
    ])('"%s": sem terceiro segue o titular; com terceiro continua o terceiro', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: null, texto })).toEqual(titular);
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(segue(FULANA));
    });

    test('o nome da empresa, quando informado, é complemento conhecido', () => {
      expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o boleto da DW', empresa: 'DW Telecom' })).toEqual(titular);
      expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o boleto da dw', empresa: 'DW Telecom' })).toEqual(titular);
    });
  });

  describe('negar o alvo atual não o reafirma', () => {
    test.each(['não é da Fulana', 'não é da fulana', 'não é o dela', 'não quero o da Fulana', 'nem é dela'])(
      'terceiro registrado + "%s": trava forte — só documento, afirmação própria ou prazo resolvem', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(trava(FULANA, 'terceiro_nao_vinculado'));
      },
    );

    test('negação de outra referência, sem afirmar nenhuma: trava fraca com terceiro, só o turno sem terceiro', () => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto: 'não é da minha mãe' })).toEqual(trava(FULANA, 'referencia_incompleta'));
      expect(resolverAlvoDoTurno({ terceiro: null, texto: 'não é da minha mãe' })).toEqual(trava(null, 'referencia_incompleta', null));
    });
  });

  describe('correção afirmativa na mesma mensagem', () => {
    test.each(['não é da Fulana, é a minha fatura', 'quero a minha fatura, não a dela', 'não, quero a minha fatura'])(
      'terceiro registrado + "%s": volta ao titular', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(volta);
      },
    );

    test.each(['não quero a minha, quero a dela', 'não é da minha mãe, é da Fulana', 'manda o boleto da Fulana, não o meu'])(
      'terceiro registrado + "%s": continua a Fulana', (texto) => {
        expect(resolverAlvoDoTurno({ terceiro: FULANA, texto })).toEqual(segue(FULANA));
      },
    );

    test('"não é da Fulana, é da minha mãe": pessoa nova — trava forte', () => {
      expect(resolverAlvoDoTurno({ terceiro: FULANA, texto: 'não é da Fulana, é da minha mãe' })).toEqual(trava(FULANA, 'terceiro_nao_vinculado'));
    });
  });
});

// A recuperação entre turnos: o worker reaplica, em ordem, as mensagens do cliente ainda não confirmadas
// sobre o escopo gravado. A função é pura; o que ela devolve diz o que o worker precisa gravar.
describe('segunda revisão da F2 — reaplicação das mensagens não confirmadas', () => {
  const FULANA = { nome: 'Fulana', contratos: [{ id: 401 }] };

  test('uma dúvida que não foi gravada volta na mensagem seguinte', () => {
    expect(resolverAlvoDasMensagens({ terceiro: FULANA, textos: ['manda o boleto da minha mãe', 'pode mandar'] })).toEqual({
      terceiro: { ...FULANA, alvoPendente: 'terceiro_nao_vinculado' }, alvoAmbiguo: 'terceiro_nao_vinculado', gravar: 'pendencia',
    });
  });

  test('uma volta ao titular que não foi gravada vale na mensagem seguinte', () => {
    expect(resolverAlvoDasMensagens({ terceiro: FULANA, textos: ['quero a minha fatura', 'manda o boleto'] }))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar' });
  });

  test('sem terceiro, outra pessoa sem documento cria o escopo pendente', () => {
    expect(resolverAlvoDasMensagens({ terceiro: null, textos: ['manda o boleto da minha mãe'] })).toEqual({
      terceiro: { nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' },
      alvoAmbiguo: 'outra_pessoa_sem_documento', gravar: 'criar',
    });
  });

  test('volta ao titular e depois outra pessoa: o escopo antigo sai e nasce um pendente', () => {
    const r = resolverAlvoDasMensagens({ terceiro: FULANA, textos: ['quero a minha fatura', 'agora o da minha mãe'] });
    expect(r.gravar).toBe('criar');
    expect(r.terceiro).toEqual({ nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' });
  });

  test('dúvida fraca resolvida por "o dela": grava o escopo sem a dúvida', () => {
    expect(resolverAlvoDasMensagens({ terceiro: { ...FULANA, alvoPendente: 'dois_lados' }, textos: ['manda o dela'] }))
      .toEqual({ terceiro: FULANA, alvoAmbiguo: false, gravar: 'pendencia' });
  });

  test('nada muda: nada a gravar', () => {
    expect(resolverAlvoDasMensagens({ terceiro: FULANA, textos: ['boleto também'] })).toEqual({ terceiro: FULANA, alvoAmbiguo: false, gravar: null });
    expect(resolverAlvoDasMensagens({ terceiro: null, textos: ['manda o boleto'] })).toEqual({ terceiro: null, alvoAmbiguo: false, gravar: null });
  });

  // Reaplicar uma mensagem já aplicada (resposta anterior sem marca de confirmação) não muda o resultado.
  test.each([
    'manda o boleto da minha mãe', 'quero a minha fatura', 'manda o dela', 'não é da Fulana', 'manda o meu e o dela',
    'vou pagar com o meu cartão', 'manda o boleto da beltrana',
  ])('reaplicar "%s" duas vezes dá o mesmo que uma', (texto) => {
    for (const terceiro of [FULANA, { ...FULANA, alvoPendente: 'referencia_incompleta' }, null]) {
      const uma = resolverAlvoDasMensagens({ terceiro, textos: [texto] });
      const duas = resolverAlvoDasMensagens({ terceiro, textos: [texto, texto] });
      expect(duas.terceiro).toEqual(uma.terceiro);
      expect(duas.alvoAmbiguo).toEqual(uma.alvoAmbiguo);
    }
  });
});

// Terceira revisão da F2 (30/09/2026): com o escopo expirado com dúvida, o contexto do turno é a dúvida sem
// autorização (sem contrato). Só a afirmação da própria cobrança ou um documento consultado resolvem.
describe('terceira revisão da F2 — expiração com dúvida', () => {
  const SEM_AUTORIZACAO = { nome: null, contratos: [], pendente: true, alvoPendente: 'terceiro_expirado' };

  test.each(['pode mandar', 'manda o dela', 'sim', 'o da Fulana', 'manda o boleto da minha mãe', 'não é da Fulana'])(
    'dúvida sem autorização + "%s": continua travado, sem cair no titular', (texto) => {
      expect(resolverAlvoDoTurno({ terceiro: SEM_AUTORIZACAO, texto })).toEqual(trava(SEM_AUTORIZACAO, 'terceiro_expirado'));
    },
  );

  test('afirmação da própria cobrança resolve: volta ao titular', () => {
    expect(resolverAlvoDoTurno({ terceiro: SEM_AUTORIZACAO, texto: 'quero a minha fatura' })).toEqual(volta);
  });

  test('nenhuma fala a reaplicar (entrada do job já processada, ou sem texto): vale a dúvida gravada, não "sem dúvida"', () => {
    const comDuvida = { nome: 'Beltrana', contratos: [{ id: 77 }], alvoPendente: 'terceiro_nao_vinculado' };
    expect(resolverAlvoDasMensagens({ terceiro: comDuvida, textos: [] })).toEqual({ terceiro: comDuvida, alvoAmbiguo: 'terceiro_nao_vinculado', gravar: null });
    expect(resolverAlvoDasMensagens({ terceiro: SEM_AUTORIZACAO, textos: [] })).toEqual({ terceiro: SEM_AUTORIZACAO, alvoAmbiguo: 'terceiro_expirado', gravar: null });
    const semDuvida = { nome: 'Beltrana', contratos: [{ id: 77 }] };
    expect(resolverAlvoDasMensagens({ terceiro: semDuvida, textos: [] })).toEqual({ terceiro: semDuvida, alvoAmbiguo: false, gravar: null });
    expect(resolverAlvoDasMensagens({ terceiro: null, textos: [] })).toEqual({ terceiro: null, alvoAmbiguo: false, gravar: null });
  });

  test('reaplicar não grava nada novo enquanto a dúvida não se resolve', () => {
    expect(resolverAlvoDasMensagens({ terceiro: SEM_AUTORIZACAO, textos: ['pode mandar', 'manda o dela'] }))
      .toEqual({ terceiro: SEM_AUTORIZACAO, alvoAmbiguo: 'terceiro_expirado', gravar: null });
  });
});

// Persistência do alvo (03/10/2026, bloqueadores 1 e 2): CPF/CNPJ numa entrada ANTERIOR à do job, ainda não
// confirmada, vale como a consulta não concluída — o pendente sem contrato. Só restringe.
describe('documento em entrada anterior não confirmada', () => {
  const FULANA = { nome: 'Fulana', contratos: [{ id: 401 }] };
  const PENDENTE = { nome: null, contratos: [], pendente: true, alvoPendente: null };
  const deOutro = { algum: true, deOutro: true };
  const proprio = { algum: true, deOutro: false };

  test('documentosValidos: só CPF e CNPJ com dígitos verificadores corretos; telefone e sequência repetida não', () => {
    expect(documentosValidos('o cpf dela é 390.533.447-05')).toEqual(['39053344705']);
    expect(documentosValidos('cnpj 11.222.333/0001-81')).toEqual(['11222333000181']);
    expect(documentosValidos('meu outro numero é 11 98765-4321')).toEqual([]);
    expect(documentosValidos('111.111.111-11')).toEqual([]);
    expect(documentosValidos('390.533.447-06')).toEqual([]);
    expect(documentosValidos(null)).toEqual([]);
    // Achado 8 da revisão: o CPF seguido de espaço e outro número também é lido; o espaçado por grupos, junto.
    expect(documentosValidos('390.533.447-05 2ª via')).toEqual(['39053344705']);
    expect(documentosValidos('390 533 447 05')).toEqual(['39053344705']);
  });

  test('titular valendo + documento de outra pessoa: o pendente sem contrato é criado', () => {
    expect(resolverAlvoDasMensagens({ terceiro: null, textos: ['390.533.447-05', 'pode mandar'], documentos: [deOutro, null] }))
      .toEqual({ terceiro: PENDENTE, alvoAmbiguo: false, gravar: 'criar' });
  });

  test('terceiro localizado + documento novo (de outro ou o próprio): o terceiro anterior deixa de valer', () => {
    for (const doc of [deOutro, proprio]) {
      expect(resolverAlvoDasMensagens({ terceiro: FULANA, textos: ['123.456.789-09', 'pode mandar'], documentos: [doc, null] }))
        .toEqual({ terceiro: PENDENTE, alvoAmbiguo: false, gravar: 'criar' });
    }
  });

  test('titular valendo + o documento de quem fala: nada muda', () => {
    expect(resolverAlvoDasMensagens({ terceiro: null, textos: ['529.982.247-25', 'manda o boleto'], documentos: [proprio, null] }))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: null });
  });

  test('pendente ou dúvida já gravados ficam como estão (não há o que restringir)', () => {
    const pendente = { nome: null, contratos: [], pendente: true };
    expect(resolverAlvoDasMensagens({ terceiro: pendente, textos: ['390.533.447-05'], documentos: [deOutro] }))
      .toEqual({ terceiro: pendente, alvoAmbiguo: false, gravar: null });
  });

  test('a própria cobrança afirmada DEPOIS do documento resolve: volta ao titular', () => {
    expect(resolverAlvoDasMensagens({ terceiro: FULANA, textos: ['123.456.789-09', 'quero a minha fatura'], documentos: [deOutro, null] }))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar' });
  });

  test('sem a marcação (a entrada do job, ou entrada sem documento): o comportamento de antes', () => {
    expect(resolverAlvoDasMensagens({ terceiro: FULANA, textos: ['390.533.447-05'] }))
      .toEqual({ terceiro: FULANA, alvoAmbiguo: false, gravar: null });
  });
});

// Pedido por endereço (06 e 07/10/2026; autorizado pelo proprietário). A rua dos contratos JÁ CONFIRMADOS do cliente só é lida
// no pedido simples ("manda o pix da Rua de Teste"); com qualquer outra palavra na mensagem vale a leitura de sempre. Rua que
// não é de contrato dele, número que não bate e mais de um contrato possível viram DÚVIDA DE ENDEREÇO, gravada entre turnos:
// esclarecimento sem pedir documento, que só termina com o contrato identificado ou com o alvo esclarecido.
describe('pedido por endereço do próprio cliente', () => {
  const ENDERECOS = [
    { id: 301, address: 'Rua de Teste, 300 - Bairro de Teste - Cidade de Teste/UF' },
    { id: 302, address: 'Avenida de Teste, 30 - Outro Bairro de Teste' },
  ];
  const MESMA_RUA = [{ id: 301, address: 'Rua de Teste, 300 - Bairro de Teste' }, { id: 303, address: 'Rua de Teste, 500 - Bairro de Teste' }];
  const SO_500 = [{ id: 303, address: 'Rua de Teste, 500 - Bairro de Teste' }, { id: 302, address: 'Avenida de Teste, 30 - Outro Bairro de Teste' }];
  const UM_SO = [{ id: 301, address: 'Rua de Teste, 300 - Bairro de Teste' }];
  const FULANA = { nome: 'Fulana', contratos: [{ id: 501 }] };
  const FRACA = { nome: 'Fulana', contratos: [{ id: 501 }], alvoPendente: 'proprio_nao_afirmado' };
  const FORTE = { nome: null, contratos: [], pendente: true, alvoPendente: 'outra_pessoa_sem_documento' };
  const DUVIDA = (motivo) => ({ nome: null, contratos: [], pendente: true, alvoPendente: motivo });
  const turno = (texto, extra = {}) => resolverAlvoDoTurno({ terceiro: null, texto, enderecos: ENDERECOS, ...extra });
  const semEnderecos = (texto, extra = {}) => resolverAlvoDoTurno({ terceiro: null, texto, ...extra, enderecos: [] });
  const mensagens = (textos, extra = {}) => resolverAlvoDasMensagens({ terceiro: null, textos, enderecos: ENDERECOS, ...extra });
  // Turnos em sequência, cada um partindo do estado que o anterior gravou (gravação bem-sucedida).
  const seguir = (falas, { terceiro = null, enderecos = ENDERECOS } = {}) => {
    let estado = terceiro;
    return falas.map((fala) => {
      const r = resolverAlvoDasMensagens({ terceiro: estado, textos: [fala], enderecos });
      estado = r.terceiro;
      return r;
    });
  };

  test('reprodução sem os endereços confirmados: continua travando como antes', () => {
    expect(resolverAlvoDoTurno({ terceiro: null, texto: 'manda o pix da Rua de Teste' })).toEqual(trava(null, 'outra_pessoa_sem_documento'));
  });

  test.each([
    ['manda o pix da Rua de Teste', '301'],
    ['e o da Avenida de Teste?', '302'],
    ['quero o boleto da rua de teste, 300', '301'],
    ['manda o pix da Avenida de Teste nº 30', '302'],
    ['oi, bom dia! manda o pix da Rua de Teste nº300, por favor', '301'],
    ['me envia a fatura da RUA DE TESTE casa 300 obrigado', '301'],
  ])('pedido simples pela rua de um contrato dele ("%s"): segue o titular, com o contrato escolhido', (texto, contrato) => {
    expect(turno(texto)).toEqual({ ...titular, contratoEscolhido: contrato });
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // A dúvida de endereço: gravada, sem pedir documento, e sem liberar nada até ser esclarecida.
  test.each([
    ['manda o pix da Rua de Teste, 900', ENDERECOS],
    ['manda o pix da Rua de Teste 300A', SO_500],
    ['manda o pix da Rua de Teste nº300', SO_500],
    ['manda o pix da Rua de Teste casa 300', SO_500],
    ['manda o pix da Rua Nova', ENDERECOS],
    ['o boleto da Avenida Central', ENDERECOS],
    ['manda o pix da Rua Beltrana', ENDERECOS],
  ])('rua ou número que não são do cadastro ("%s"): dúvida de endereço gravada, sem terceiro nem documento', (texto, enderecos) => {
    expect(turno(texto, { enderecos })).toEqual(trava(null, 'endereco_desconhecido'));
    expect(mensagens([texto], { enderecos })).toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'criar' });
  });

  // Rua que não é dele com mais de uma palavra: a palavra que abre um logradouro ("Rua", "Avenida", "Travessa"…, mesmo que
  // nenhum contrato dele tenha esse tipo), "da/do" opcional logo depois dela e de um a três nomes. "da/do" DEPOIS de um nome
  // continua sendo dono ("Rua Nova do Fulano", "Rua Sete de Setembro": leitura de sempre).
  test.each([
    'manda o pix da Rua da Paz', 'o boleto da Avenida Getulio Vargas, 12, por favor', 'manda o pix da Avenida Presidente Getulio Vargas',
    'manda o pix da Travessa das Flores', 'manda o pix da rua do Fulano', 'manda o boleto da Avenida da Beltrana',
    'manda o pix da Rua Nova trezentos', 'manda o pix da Rua Nova nr 300', 'manda o pix da Rua de Testes', 'manda o pix da Rua da Paz, 12',
    'manda o pix da Av. Brasil, 10', 'manda o pix da R. da Paz',
  ])('rua que não é dele, com mais de uma palavra ("%s"): dúvida de endereço gravada; com terceiro, a leitura de produção', (texto) => {
    expect(turno(texto)).toEqual(trava(null, 'endereco_desconhecido'));
    expect(mensagens([texto])).toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'criar' });
    expect(mensagens([texto], { terceiro: DUVIDA('endereco_desconhecido') }))
      .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: null });
    for (const terceiro of [FULANA, FRACA, FORTE]) expect(turno(texto, { terceiro })).toEqual(semEnderecos(texto, { terceiro }));
  });
  test('rua que não é dele, com mais de uma palavra, também quando o cadastro só tem logradouro sem o tipo', () => {
    const SEM_TIPO = [{ id: 401, address: 'FULANO DE TESTE, 523' }];
    expect(turno('manda o pix da Rua da Paz', { enderecos: SEM_TIPO })).toEqual(trava(null, 'endereco_desconhecido'));
    expect(turno('manda o pix da Avenida Getulio Vargas', { enderecos: SEM_TIPO })).toEqual(trava(null, 'endereco_desconhecido'));
  });
  test('rua que não é dele, com mais de uma palavra, entre turnos: "pode mandar" não libera; "é da minha mãe" segue as regras de terceiro; a rua dele libera só ela', () => {
    expect(seguir(['manda o pix da Rua da Paz', 'pode mandar', 'é da minha mãe']).map((x) => [x.alvoAmbiguo, x.gravar]))
      .toEqual([['endereco_desconhecido', 'criar'], ['endereco_desconhecido', null], ['outra_pessoa_sem_documento', 'pendencia']]);
    const r = seguir(['manda o pix da Avenida Getulio Vargas', 'obrigado', 'é a da Rua de Teste']);
    expect(r.map((x) => x.alvoAmbiguo)).toEqual(['endereco_desconhecido', 'endereco_desconhecido', false]);
    expect(r[2]).toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: '301', contratosEscolhidos: ['301'] });
  });

  test('dois contratos na mesma rua, sem o número: dúvida de endereço gravada (qual dos dois); com o número, o contrato', () => {
    expect(turno('manda o pix da Rua de Teste', { enderecos: MESMA_RUA })).toEqual(trava(null, 'endereco_ambiguo'));
    expect(turno('manda o pix da Rua de Teste, 500', { enderecos: MESMA_RUA })).toEqual({ ...titular, contratoEscolhido: '303' });
  });

  test.each(['pode mandar', 'obrigado', 'ok, manda', 'oi', 'manda o pix', 'quero pagar'])(
    'com a dúvida gravada, "%s" não libera nada: a dúvida continua, sem nova gravação', (fala) => {
      for (const motivo of ['endereco_desconhecido', 'endereco_ambiguo']) {
        expect(mensagens([fala], { terceiro: DUVIDA(motivo) })).toEqual({ terceiro: DUVIDA(motivo), alvoAmbiguo: motivo, gravar: null });
      }
    });

  test('a sequência inteira: dúvida, "pode mandar", agradecimento, reprocessamento e o esclarecimento pela rua dele', () => {
    const r = seguir(['manda o pix da Rua Nova', 'pode mandar', 'obrigado', 'pode mandar', 'é a da Rua de Teste']);
    expect(r.map((x) => [x.alvoAmbiguo, x.gravar])).toEqual([
      ['endereco_desconhecido', 'criar'], ['endereco_desconhecido', null], ['endereco_desconhecido', null], ['endereco_desconhecido', null], [false, 'limpar'],
    ]);
    expect(r[4]).toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: '301', contratosEscolhidos: ['301'] });
    // Reprocessar as mesmas falas sobre o estado gravado dá o mesmo resultado (idempotente).
    expect(mensagens(['manda o pix da Rua Nova', 'pode mandar'], { terceiro: DUVIDA('endereco_desconhecido') }))
      .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: null });
  });

  test.each([
    ['é a da Rua de Teste', '301'], ['Rua de Teste, 300', '301'], ['é a Rua de Teste', '301'], ['na Avenida de Teste', '302'],
    ['a da Avenida de Teste, por favor', '302'], ['manda o pix da Rua de Teste', '301'],
  ])('com a dúvida gravada, a resposta "%s" identifica o contrato: volta ao titular com ele', (fala, contrato) => {
    expect(mensagens([fala], { terceiro: DUVIDA('endereco_desconhecido') }))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: contrato, contratosEscolhidos: [contrato] });
  });

  test.each(['não é a Rua de Teste', 'é a Rua de Teste da minha mãe', 'a Rua de Teste não', 'é a Rua de Teste e a Avenida de Teste'])(
    'com a dúvida gravada, "%s" não identifica contrato com segurança: nada sai', (fala) => {
      const r = mensagens([fala], { terceiro: DUVIDA('endereco_desconhecido') });
      expect(r.alvoAmbiguo).toBeTruthy();
      expect(r.contratoEscolhido).toBeUndefined();
      expect(r.contratosEscolhidos).toBeUndefined();
    });

  test('dúvida de mesma rua: a resposta com o número identifica; sem o número, continua', () => {
    expect(mensagens(['a da Rua de Teste, 500'], { terceiro: DUVIDA('endereco_ambiguo'), enderecos: MESMA_RUA }))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: '303', contratosEscolhidos: ['303'] });
    expect(mensagens(['é a da Rua de Teste'], { terceiro: DUVIDA('endereco_ambiguo'), enderecos: MESMA_RUA }))
      .toEqual({ terceiro: DUVIDA('endereco_ambiguo'), alvoAmbiguo: 'endereco_ambiguo', gravar: null });
  });

  test.each(['é da minha mãe', 'é de outra pessoa', 'é dela', 'é da Beltrana'])(
    'com a dúvida gravada, "%s": é de outra pessoa — seguem as regras de terceiro (dúvida forte, gravada)', (fala) => {
      expect(mensagens([fala], { terceiro: DUVIDA('endereco_desconhecido') }))
        .toEqual({ terceiro: DUVIDA('outra_pessoa_sem_documento'), alvoAmbiguo: 'outra_pessoa_sem_documento', gravar: 'pendencia' });
    });

  test('com a dúvida gravada, "é a minha mesmo": com um contrato só, ele; com mais de um, a dúvida passa a ser qual (nunca volta sem contrato)', () => {
    expect(mensagens(['é a minha fatura mesmo'], { terceiro: DUVIDA('endereco_desconhecido'), enderecos: UM_SO }))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: '301', contratosEscolhidos: ['301'] });
    expect(mensagens(['é a minha fatura mesmo'], { terceiro: DUVIDA('endereco_desconhecido') }))
      .toEqual({ terceiro: DUVIDA('endereco_ambiguo'), alvoAmbiguo: 'endereco_ambiguo', gravar: 'pendencia' });
  });

  test('a dúvida não some com uma rua desconhecida nova: continua; e uma ambiguidade nova a troca pela de qual contrato', () => {
    expect(mensagens(['o da Avenida Central'], { terceiro: DUVIDA('endereco_desconhecido') }))
      .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: null });
    expect(mensagens(['é a Rua de Teste'], { terceiro: DUVIDA('endereco_desconhecido'), enderecos: MESMA_RUA }))
      .toEqual({ terceiro: DUVIDA('endereco_ambiguo'), alvoAmbiguo: 'endereco_ambiguo', gravar: 'pendencia' });
  });

  // Revisão do v4 (07/10/2026, achado A1): no mesmo lote, ninguém perguntou nada ainda — a fala seguinte não é resposta. A
  // dúvida de um endereço citado no lote não termina no mesmo lote, em qualquer ordem; só pode piorar (outra pessoa).
  test.each([
    [['manda o pix da Rua Nova', 'é a da Rua de Teste']],
    [['manda o pix da Rua Nova', 'manda o pix da Rua de Teste']],
    [['manda o pix da Rua de Teste', 'manda o pix da Rua Nova']],
    [['manda o pix da Rua Nova', 'pode mandar']],
    [['manda o pix da Rua Nova', 'manda o pix da Avenida Central', 'manda o pix da Rua de Teste']],
    [['manda o pix da Rua Nova', 'é a minha fatura mesmo']],
    [['manda o pix da Rua da Paz', 'a da Avenida de Teste, por favor']],
  ])('no lote não confirmado (%j): a dúvida do endereço citado continua, gravada, sem contrato escolhido', (falas) => {
    expect(mensagens(falas)).toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'criar' });
    expect(mensagens([...falas].reverse()).alvoAmbiguo).toBeTruthy();
  });
  test('no lote não confirmado: dúvida e depois "é da minha mãe" piora para outra pessoa (regras de terceiro)', () => {
    expect(mensagens(['manda o pix da Rua Nova', 'é da minha mãe']))
      .toEqual({ terceiro: DUVIDA('outra_pessoa_sem_documento'), alvoAmbiguo: 'outra_pessoa_sem_documento', gravar: 'criar' });
  });
  test('com a dúvida gravada, um endereço desconhecido citado no lote também segura o resto do lote', () => {
    expect(mensagens(['é a Rua Nova', 'é a da Rua de Teste'], { terceiro: DUVIDA('endereco_desconhecido') }))
      .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: null });
  });

  // Revisão do v4 (achado A2): a resposta que identifica o contrato limita a cobrança do turno a ele; uma fala NEUTRA depois no
  // mesmo lote ("obrigado", "ok, pode mandar", imagem) não desfaz essa limitação. Outro pedido simples soma.
  test.each([
    [['Rua de Teste', 'obrigado'], ['301']],
    [['Rua de Teste', 'pode mandar'], ['301']],
    [['Rua de Teste', 'ok, pode mandar'], ['301']],
    [['Rua de Teste', 'isso mesmo, obrigado'], ['301']],
    [['Rua de Teste', 'manda o pix'], ['301']],
    [['Rua de Teste', 'manda a segunda via'], ['301']],
    [['Rua de Teste', '👍'], ['301']],
    [['Rua de Teste', ''], ['301']],
    [['Rua de Teste', null], ['301']],
    [['a da Rua de Teste', 'e o da Avenida de Teste'], ['301', '302']],
  ])('com a dúvida gravada, a resposta e depois %j: a cobrança fica limitada a %j', (falas, contratos) => {
    const TRES = [...ENDERECOS, { id: 304, address: 'Travessa de Teste, 40' }];
    expect(mensagens(falas, { terceiro: DUVIDA('endereco_desconhecido'), enderecos: TRES })).toEqual({
      terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratosEscolhidos: contratos,
      ...(contratos.length === 1 ? { contratoEscolhido: contratos[0] } : {}),
    });
  });
  // Revisão da v4.1 (07/10/2026, achado B1): a resposta seguida de uma fala que NÃO é neutra — uma correção, outra rua sem
  // "da/do", uma negação — não deixa a cobrança presa ao contrato que ele pode ter acabado de desdizer, nem tira a dúvida do
  // banco: a dúvida volta, e não termina mais neste lote (nem por uma terceira fala).
  test.each([
    'ops, é a outra casa', 'não, Avenida de Teste', 'não é essa', 'Avenida de Teste', 'é a outra', 'pera, é a Travessa de Teste, 40',
    'não, não é a da Rua de Teste', 'na verdade é a outra', 'errei',
    // Revisão da v4.2 (achado C1): a palavra de escolha — "segunda" só é neutra em "segunda via".
    'a segunda', 'é a segunda', 'manda a segunda', 'a primeira', 'a última', 'a terceira',
    // Revisão da rodada 7 (P1-1): "via" em outra oração não faz de "segunda" a "segunda via".
    'a segunda, via pix', 'a segunda. via pix', 'a segunda\nvia pix', 'é a segunda, via pix por favor',
  ])('com a dúvida gravada, a resposta e depois "%s": a dúvida volta, regravada (marca nova), sem contrato escolhido e sem limpar', (correcao) => {
    const TRES = [...ENDERECOS, { id: 304, address: 'Travessa de Teste, 40' }];
    const r = mensagens(['Rua de Teste', correcao], { terceiro: DUVIDA('endereco_desconhecido'), enderecos: TRES });
    // Rodada 7 (ressalva C3): a dúvida devolvida é REGRAVADA ('pendencia', marca nova), para a limpeza adiada de outro job,
    // condicional à marca antiga, não passar por cima dela.
    expect(r).toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'pendencia' });
    expect(mensagens(['Rua de Teste', correcao, 'Avenida de Teste'], { terceiro: DUVIDA('endereco_desconhecido'), enderecos: TRES }))
      .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'pendencia' });
    // E no turno seguinte, sobre o estado gravado, "pode mandar" continua sem liberar nada.
    expect(mensagens(['pode mandar'], { terceiro: r.terceiro, enderecos: TRES }))
      .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: null });
  });
  // Revisão da v4.2 (achado C4): o que se GRAVA também é o mais restritivo — a dúvida nova é criada, nunca a volta ao titular.
  test('com a dúvida gravada, a resposta e depois "é da minha mãe" ou "a de cima": vale o mais restritivo (outra pessoa), gravado', () => {
    for (const fala of ['é da minha mãe', 'a de cima']) {
      // "a de cima" é lido como sempre (referência a outra pessoa): também o mais restritivo, nunca a resposta.
      expect(mensagens(['Rua de Teste', fala], { terceiro: DUVIDA('endereco_desconhecido') }))
        .toEqual({ terceiro: DUVIDA('outra_pessoa_sem_documento'), alvoAmbiguo: 'outra_pessoa_sem_documento', gravar: 'criar' });
    }
  });
  test('com a dúvida gravada, a resposta e depois um endereço desconhecido: volta a dúvida, gravada', () => {
    expect(mensagens(['Rua de Teste', 'e o da Rua Nova'], { terceiro: DUVIDA('endereco_desconhecido') }))
      .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'criar' });
  });

  // Rodada 9 (N4-C, opção C autorizada): a fala neutra (ou não classificada, ou sem texto) depois do pedido não desfaz mais a
  // escolha — antes, liberava os dois contratos. "pode mandar" no meio mantém o 301, e o pedido seguinte soma.
  test('duas falas com contratos diferentes: os dois valem, nenhum substitui o outro; fala neutra no meio mantém a primeira', () => {
    expect(mensagens(['manda o pix da Rua de Teste', 'e o da Avenida de Teste']))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: null, contratosEscolhidos: ['301', '302'] });
    expect(mensagens(['manda o pix da Rua de Teste', 'manda o pix da Rua de Teste']))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: null, contratoEscolhido: '301', contratosEscolhidos: ['301'] });
    expect(mensagens(['manda o pix da Rua de Teste', 'pode mandar', 'e o da Avenida de Teste']))
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: null, contratosEscolhidos: ['301', '302'] });
    const so301 = { terceiro: null, alvoAmbiguo: false, gravar: null, contratoEscolhido: '301', contratosEscolhidos: ['301'] };
    expect(mensagens(['manda o pix da Rua de Teste', 'pode mandar'])).toEqual(so301);
    expect(mensagens(['manda o pix da Rua de Teste', ''])).toEqual(so301);
    expect(mensagens(['manda o pix da Rua de Teste', null])).toEqual(so301);
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // Com terceiro: a rua DE UM CONTRATO DELE sem afirmar a própria cobrança é a dúvida fraca entre o próprio e o terceiro (como
  // na produção) — nada sai até ele esclarecer; "o dela" é o esclarecimento explícito do terceiro já autorizado por documento.
  test('com terceiro localizado, a rua de um contrato dele: dúvida fraca gravada, sem pedir documento', () => {
    expect(turno('agora o pix da Rua de Teste', { terceiro: FULANA })).toEqual(trava(FULANA, 'proprio_nao_afirmado'));
  });
  // Revisão do v4 (achado A3): com terceiro no contexto, a rua que não é de contrato dele, o número que não é o do cadastro e o
  // logradouro sem o tipo NÃO são lidos — vale a leitura da produção (terceiro não vinculado, que pede o documento). Ler "rua do
  // João" como endereço trocava a dúvida forte pela fraca, e "o dele" liberava o terceiro registrado.
  test.each([
    'manda o pix da Rua Nova', 'manda o pix da Rua de Teste, 900', 'manda o pix da Rua de Teste, 500', 'manda o boleto da rua do Joao',
    'manda o boleto da rua da Fulana', 'manda o boleto da rua do seu Joao', 'manda o boleto da rua da dona Maria', 'manda o boleto da tv maria',
    'manda o boleto da travessa do Joao Silva', 'o boleto da rua do sicrano por favor', 'manda o pix da Rua da Paz', 'manda o pix da Avenida Central',
    'agora a minha fatura da Rua Nova', 'quero o meu da Avenida Getulio Vargas',
  ])('com terceiro no contexto, "%s": a leitura da produção, nos três estados de terceiro', (texto) => {
    for (const terceiro of [FULANA, FRACA, FORTE]) expect(turno(texto, { terceiro })).toEqual(semEnderecos(texto, { terceiro }));
  });
  test('com terceiro no contexto, o logradouro sem o tipo não é lido (como na produção)', () => {
    const SEM_TIPO = [{ id: 401, address: 'FULANO DE TESTE, 523' }, ...ENDERECOS];
    for (const texto of ['o boleto do Fulano de Teste, 523', 'o boleto do Fulano de Teste']) {
      for (const terceiro of [FULANA, FRACA, FORTE]) expect(turno(texto, { terceiro, enderecos: SEM_TIPO })).toEqual(semEnderecos(texto, { terceiro }));
    }
  });
  test('com terceiro: "rua do João" e depois "o dele" ou "o dela", no mesmo lote ou em turnos: nada é liberado', () => {
    expect(mensagens(['manda o boleto da rua do Joao', 'manda o dele'], { terceiro: FULANA }).alvoAmbiguo).toBe('terceiro_nao_vinculado');
    expect(mensagens(['manda o boleto da rua da Fulana', 'o dela'], { terceiro: FULANA }).alvoAmbiguo).toBeTruthy();
    expect(seguir(['manda o boleto da rua do Joao', 'o dela'], { terceiro: FULANA }).map((x) => x.alvoAmbiguo))
      .toEqual(['terceiro_nao_vinculado', 'terceiro_nao_vinculado']);
  });
  test('com terceiro: a dúvida fraca não cai com "pode mandar"; "o dela" segue o terceiro; "a minha" volta ao titular', () => {
    const r = seguir(['agora o pix da Rua de Teste', 'pode mandar', 'o dela'], { terceiro: FULANA });
    expect(r.map((x) => x.alvoAmbiguo)).toEqual(['proprio_nao_afirmado', 'proprio_nao_afirmado', false]);
    expect(r[2].terceiro).toEqual(FULANA);
    expect(seguir(['manda o pix da Rua Nova', 'a minha fatura da Rua de Teste'], { terceiro: FULANA })[1])
      .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratoEscolhido: '301', contratosEscolhidos: ['301'] });
  });
  test('dúvida forte gravada + rua desconhecida ou do cadastro: a dúvida forte não é trocada', () => {
    for (const texto of ['manda o pix da Rua de Teste', 'manda o pix da Rua Nova', 'manda o pix da Rua de Teste, 900']) {
      expect(turno(texto, { terceiro: FORTE })).toEqual(trava(FORTE, 'outra_pessoa_sem_documento'));
    }
  });
  test('volta explícita ao próprio, com a rua: volta ao titular com o contrato escolhido (ou com a dúvida de qual, gravada)', () => {
    expect(turno('agora a minha fatura da Rua de Teste', { terceiro: FULANA })).toEqual({ ...volta, contratoEscolhido: '301' });
    expect(turno('agora a minha fatura da Rua de Teste', { terceiro: FORTE })).toEqual({ ...volta, contratoEscolhido: '301' });
    expect(turno('agora quero o meu, da Rua de Teste', { terceiro: FULANA })).toEqual(trava(FULANA, 'proprio_nao_afirmado'));
    expect(mensagens(['agora a minha fatura da Rua de Teste'], { terceiro: FULANA, enderecos: MESMA_RUA }))
      .toEqual({ terceiro: DUVIDA('endereco_ambiguo'), alvoAmbiguo: 'endereco_ambiguo', gravar: 'criar' });
  });
  test('o nome do terceiro depois de quem abre uma rua não vira rua desconhecida', () => {
    for (const texto of ['manda o pix da Rua Fulana', 'manda o pix da Rua da Fulana', 'manda o pix da Rua Nova Fulana']) {
      expect(turno(texto, { terceiro: FULANA })).toEqual(semEnderecos(texto, { terceiro: FULANA }));
    }
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // Logradouro sem o tipo (o formato dos registros e testes: "NOME SOBRENOME, número").
  test('logradouro sem o tipo: com o número, o contrato; sem o número, dúvida (endereço dele ou nome de pessoa); só o primeiro nome, leitura de sempre', () => {
    const SEM_TIPO = [{ id: 401, address: 'FULANO DE TESTE, 523' }, { id: 302, address: 'Avenida de Teste, 30 - Outro Bairro de Teste' }];
    expect(turno('o boleto do Fulano de Teste, 523', { enderecos: SEM_TIPO })).toEqual({ ...titular, contratoEscolhido: '401' });
    expect(turno('o boleto do Fulano de Teste', { enderecos: SEM_TIPO })).toEqual(trava(null, 'endereco_desconhecido'));
    expect(turno('o boleto do Fulano de Teste, 900', { enderecos: SEM_TIPO })).toEqual(trava(null, 'endereco_desconhecido'));
    for (const texto of ['o boleto do Fulano', 'o boleto do Fulano Silva', 'manda o boleto do Fulano, por favor']) {
      expect(turno(texto, { enderecos: SEM_TIPO })).toEqual(semEnderecos(texto));
    }
    expect(seguir(['o boleto do Fulano de Teste', 'pode mandar', 'é de outra pessoa'], { enderecos: SEM_TIPO }).map((x) => x.alvoAmbiguo))
      .toEqual(['endereco_desconhecido', 'endereco_desconhecido', 'outra_pessoa_sem_documento']);
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // Fora do pedido simples, a rua não é lida: o resultado é EXATAMENTE o da leitura sem endereços.
  const FORA = [
    'o pix da Rua de Teste do Fulano', 'o pix da Rua de Teste do Fulano 300', 'o pix da Rua de Teste, 500, do Fulano',
    'manda o pix da Rua de Teste nº500 do Fulano', 'o pix da Rua de Teste da mãe', 'o pix da Rua de Teste da mãe 300',
    'o pix da Rua de Teste da minha mãe', 'o pix da Rua de Teste do vizinho', 'o pix da Rua de Teste dela',
    'o pix da Rua de Teste dela 300', 'o pix dela da Rua de Teste', 'o pix da Rua de Teste e o dela',
    'o pix da Rua de Teste e o da Fulana', 'o pix da Rua de Teste e o da Beltrana', 'manda o pix da Rua de Teste ou da Beltrana',
    'manda a minha fatura da Rua de Teste do Fulano 300', 'a minha fatura da Rua de Teste e a da Beltrana',
    'agora o pix da Rua de Teste de outubro', 'manda o pix da Rua de Teste de novo', 'manda o pix da Rua de Teste do mês passado',
    'quero pagar a conta da Rua de Teste que venceu', 'manda o pix da Rua de Teste, vou pagar com o cartão do Fulano',
    'manda também o da Avenida de Teste', 'é da Rua de Teste', 'manda o pix e o da Rua de Teste',
    'manda o pix da Rua de Teste trezentos', 'o pix da Rua de Teste, que fica no 300', 'o pix da Rua de Teste de 300 reais',
    'manda o pix da Rua de Teste, 500 300', 'manda o pix da Rua de Teste 300/12', 'manda o pix da Rua de Teste, 300, apto 12',
    'manda o pix da Rua de Teste de 300', 'manda o pix da Rua de Teste nr 300', 'manda o pix da Rua de Teste 300 e 500',
    'não é o da Rua de Teste', 'o pix da Rua de Teste não', 'menos o da Rua de Teste', 'exceto o da Rua de Teste',
    'manda o pix da Rua de Teste, menos esse', 'não é o da Rua de Teste do Fulano', 'não, é o da Rua de Teste',
    'manda o pix da Rua de Teste, ou melhor, o outro', 'o da Rua de Teste já paguei, manda o outro', 'manda o pix da Rua de Teste e o outro',
    'manda o pix da Rua de Teste, ops, é o da outra casa', 'manda o pix da Rua de Teste. Ops, é a Avenida de Teste',
    'manda o pix da Rua de Teste e o da Avenida de Teste',
    'manda o pix da rua dela', 'manda o pix da rua do vizinho', 'manda o pix da Rua da minha mãe',
    'manda o pix da Rua Nova do Fulano', 'manda o pix da rua não', 'o pix da Rua', 'manda o pix da Rua 7',
    'manda a minha fatura da rua dela', 'o boleto da Maria, por favor', 'o boleto do Fulano Beltrano Silva',
    'para o boleto da Rua de Teste', 'pra o boleto da Rua de Teste', 'manda o pix da Rua Nova, menos esse',
    'manda o pix da Rua Sete de Setembro', 'manda o pix da Rua da Paz do Fulano', 'manda o pix da Rua da Paz dela',
    'manda o pix da Rua Alfa Beta Gama Delta', 'manda o pix da Rua da Paz, 12, apto 3', 'manda o pix da Rua da da Paz',
    'manda o pix da Rua da Paz, menos esse',
  ];
  const ESTADOS = { 'sem terceiro': null, 'terceiro localizado': FULANA, 'dúvida fraca': FRACA, 'dúvida forte': FORTE };
  test.each(FORA.flatMap((texto) => Object.keys(ESTADOS).map((estado) => [texto, estado])))(
    'fora do pedido simples ("%s", %s): igual à leitura sem endereços', (texto, estado) => {
      const terceiro = ESTADOS[estado];
      expect(turno(texto, { terceiro })).toEqual(semEnderecos(texto, { terceiro }));
      expect(turno(texto, { terceiro, enderecos: [...ENDERECOS, ...MESMA_RUA] })).toEqual(semEnderecos(texto, { terceiro }));
    });

  test('uma rua do cadastro que é outra rua seguida de número: cada uma com o próprio número; colisão vira dúvida de qual (gravada)', () => {
    const FLORES = [{ id: 701, address: 'RUA DAS FLORES, 100 - Centro' }, { id: 702, address: 'RUA DAS FLORES 100, CASA 5 - Centro' }];
    expect(turno('manda o pix da Rua das Flores, 100', { enderecos: FLORES })).toEqual(trava(null, 'endereco_ambiguo'));
    expect(turno('manda o pix da Rua das Flores nº 100', { enderecos: FLORES })).toEqual(trava(null, 'endereco_ambiguo'));
    expect(turno('manda o pix da Rua das Flores', { enderecos: FLORES })).toEqual(trava(null, 'endereco_ambiguo'));
    const FLORES_200 = [{ id: 711, address: 'RUA DAS FLORES, 200 - Centro' }, { id: 702, address: 'RUA DAS FLORES 100, CASA 5 - Centro' }];
    expect(turno('o pix da Rua das Flores', { enderecos: FLORES_200 })).toEqual(trava(null, 'endereco_ambiguo'));
    expect(turno('o pix da Rua das Flores, 200', { enderecos: FLORES_200 })).toEqual({ ...titular, contratoEscolhido: '711' });
    expect(turno('manda o pix da Rua das Flores 100 casa 5', { enderecos: FLORES })).toEqual({ ...titular, contratoEscolhido: '702' });
    const PROJETADA = [{ id: 425, address: 'Rua Projetada, 2' }, { id: 426, address: 'Rua Projetada 2, 15' }];
    expect(turno('o pix da Rua Projetada, 2', { enderecos: PROJETADA })).toEqual(trava(null, 'endereco_ambiguo'));
    expect(turno('o pix da Rua Projetada', { enderecos: PROJETADA })).toEqual(trava(null, 'endereco_ambiguo'));
    expect(turno('o pix da Rua Projetada 2, 15', { enderecos: PROJETADA })).toEqual({ ...titular, contratoEscolhido: '426' });
  });

  // Rodada 8 (N2, avaliação real do endereço): a correção do cliente ("Ops, me enganei, é o da …") não cria terceiro. Um prefixo
  // de correção de uma lista fechada sai da frente e o resto é lido como sempre: a rua de um contrato dele escolhe o contrato e
  // SUBSTITUI o que foi desdito no lote; a correção sem contrato identificado vira dúvida de endereço (o desdito não fica como
  // destino). A interjeição não autoriza nada: com terceiro ou dúvida forte, vale a leitura de sempre.
  describe('a correção do cliente (rodada 8, N2)', () => {
    const COM_500 = [...ENDERECOS, { id: 305, address: 'Rua de Teste, 500 - Bairro de Teste' }];
    const so = (contratos) => ({ terceiro: null, alvoAmbiguo: false, gravar: null, contratosEscolhidos: contratos, ...(contratos.length === 1 ? { contratoEscolhido: contratos[0] } : {}) });
    test.each([
      [['manda o pix da Rua de Teste', 'Ops, me enganei, é o da Avenida de Teste.']],
      [['Ops, é o da Avenida de Teste.']],
      [['Na verdade é a da Avenida de Teste.']],
      [['manda o pix da Rua de Teste', 'Errei, manda o da Avenida de Teste.']],
      [['manda o pix da Rua de Teste', 'Desculpa, me enganei, é o pix da Avenida de Teste, por favor.']],
      [['manda o pix da Rua de Teste', 'Ops, me enganei.', 'É o da Avenida de Teste.']],
      // Revisão do incremento (achado A): o marcador de duplo sentido seguido de OUTRA rua dele também corrige — substitui.
      [['manda o pix da Rua de Teste', 'Opa, desculpa, é o pix da Avenida de Teste, por favor.']],
      [['manda o pix da Rua de Teste', 'desculpa, é o da Avenida de Teste']],
      [['manda o pix da Rua de Teste', 'foi mal, é o da Avenida de Teste']],
      [['manda o pix da Rua de Teste', 'pera, é o da Avenida de Teste']],
      [['manda o pix da Rua de Teste', 'epa, o da Avenida de Teste']],
      [['manda o pix da Rua de Teste', 'opa, e o da Avenida de Teste']],
    ])('%j: só o 302 (a correção substitui o desdito)', (falas) => {
      expect(mensagens(falas)).toEqual(so(['302']));
    });
    test.each([
      [['manda o pix da Rua de Teste', 'Ops, me enganei.']],
      [['manda o pix da Rua de Teste', 'ops, é a outra casa']],
      [['manda o pix da Rua de Teste', 'Ops, é o da Rua Nova.']],
    ])('%j: desdisse sem identificar outro dele: dúvida de endereço gravada, nenhum contrato escolhido', (falas) => {
      expect(mensagens(falas)).toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'criar' });
    });
    test('correção para uma rua com dois contratos dele: dúvida de qual', () => {
      expect(mensagens(['manda o pix da Avenida de Teste', 'Ops, me enganei, é o da Rua de Teste.'], { enderecos: COM_500 }))
        .toEqual({ terceiro: DUVIDA('endereco_ambiguo'), alvoAmbiguo: 'endereco_ambiguo', gravar: 'criar' });
    });
    test('a referência explícita a terceiro na correção continua outra pessoa', () => {
      expect(mensagens(['manda o pix da Rua de Teste', 'Ops, é o da minha mãe.'])).toEqual({ terceiro: FORTE, alvoAmbiguo: 'outra_pessoa_sem_documento', gravar: 'criar' });
    });
    test('a negação sem vírgula ("não é o da …") não é correção: continua como antes', () => {
      expect(mensagens(['manda o pix da Rua de Teste', 'não é o da Avenida de Teste'])).toEqual({ terceiro: null, alvoAmbiguo: 'referencia_incompleta', gravar: null });
    });
    test('a interjeição não volta ao titular: com terceiro, a rua dele vale como sem ela (dúvida fraca); com dúvida forte, a dúvida fica', () => {
      const comTerceiro = mensagens(['Ops, me enganei, é o da Avenida de Teste.'], { terceiro: FULANA });
      expect(comTerceiro).toEqual(mensagens(['é o da Avenida de Teste.'], { terceiro: FULANA }));
      expect(comTerceiro).toMatchObject({ alvoAmbiguo: 'proprio_nao_afirmado', gravar: 'pendencia' });
      expect(mensagens(['Ops, me enganei, é o da Avenida de Teste.'], { terceiro: FORTE })).toEqual({ terceiro: FORTE, alvoAmbiguo: 'outra_pessoa_sem_documento', gravar: null });
    });
    test('com a dúvida gravada: a resposta e a correção para a outra rua deixam só a outra; a resposta desdita sem rua devolve a dúvida', () => {
      expect(mensagens(['É a da Rua de Teste.', 'Ops, me enganei, é a da Avenida de Teste.'], { terceiro: DUVIDA('endereco_desconhecido') }))
        .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratosEscolhidos: ['302'], contratoEscolhido: '302' });
      expect(mensagens(['É a da Rua de Teste.', 'Ops, me enganei.'], { terceiro: DUVIDA('endereco_desconhecido') }))
        .toEqual({ terceiro: DUVIDA('endereco_desconhecido'), alvoAmbiguo: 'endereco_desconhecido', gravar: 'pendencia' });
      // Revisão do incremento (achado A): também com o marcador de duplo sentido seguido da outra rua.
      expect(mensagens(['É a da Rua de Teste.', 'desculpa, é o da Avenida de Teste'], { terceiro: DUVIDA('endereco_desconhecido') }))
        .toEqual({ terceiro: null, alvoAmbiguo: false, gravar: 'limpar', contratosEscolhidos: ['302'], contratoEscolhido: '302' });
    });
    // Revisão da rodada 8 (achado 9): prefixos de duplo sentido ("opa", "desculpa", "pera", "foi mal") SEM outra rua não
    // substituem o contrato nem criam a dúvida — "opa, obrigado" e "desculpa a demora" seguem como na produção. Com outra rua
    // dele, substituem (achado A, acima).
    test('prefixo de duplo sentido sem outra rua não é correção: não substitui nem cria dúvida, e ainda deixa ler a rua', () => {
      for (const fala of ['opa, obrigado', 'pera, pode mandar', 'desculpa, obrigado']) {
        expect(mensagens(['manda o pix da Rua de Teste', fala])).toEqual(mensagens(['manda o pix da Rua de Teste', 'obrigado']));
      }
      // Rodada 9 (N4-C): fora da lista neutra, a fala depois do pedido pela rua vira a dúvida de endereço SÓ DO TURNO (o lado
      // seguro: nem o pedido forçado, nem os outros liberados) — "desculpa a demora" incluída; nada se grava.
      expect(mensagens(['manda o pix da Rua de Teste', 'desculpa a demora'])).toEqual({ terceiro: null, alvoAmbiguo: 'endereco_desconhecido', gravar: null });
      expect(mensagens(['Opa, é o da Avenida de Teste.'])).toEqual(so(['302']));
    });

    test('dois pedidos sem correção continuam valendo os dois', () => {
      expect(mensagens(['manda o pix da Rua de Teste', 'e o da Avenida de Teste'])).toEqual(so(['301', '302']));
    });
  });

  // Rodada 9 (N4-C, opção C autorizada; revisão da rodada 9, achados 1, 2 e 6): o pedido relido com a mensagem nova (a reserva
  // recusada) ou no mesmo lote. A fala sem nova escolha nunca libera os outros contratos nem força o pedido antigo: só a NEUTRA (ou
  // sem texto) mantém exatamente o contrato pedido; a desistência (sem pedido de cobrança na fala, depois de um pedido no lote) não
  // deixa autorização no turno; o resto — o que o código não classifica com segurança, inclusive outra rua dele fora da forma
  // estrita — vira a dúvida de endereço SÓ DO TURNO (não se grava). Com um contrato só, não há o que ampliar: mantém.
  describe('a fala depois do pedido pela rua (rodada 9, N4-C)', () => {
    const so = (contratos) => ({ terceiro: null, alvoAmbiguo: false, gravar: null, contratosEscolhidos: contratos, ...(contratos.length === 1 ? { contratoEscolhido: contratos[0] } : {}) });
    const DESISTIU = { terceiro: null, alvoAmbiguo: 'desistencia', gravar: null };
    const DUVIDA_DO_TURNO = { terceiro: null, alvoAmbiguo: 'endereco_desconhecido', gravar: null };
    const NADA = { terceiro: null, alvoAmbiguo: false, gravar: null };
    test.each([['obrigado'], ['Obrigado!'], ['ok'], ['beleza, pode mandar'], ['valeu 👍'], ['sim'], ['pode ser'], [''], [null]])(
      '%j depois do pedido: mantém exatamente o contrato pedido', (fala) => {
        expect(mensagens(['manda o pix da Rua de Teste', fala])).toEqual(so(['301']));
      },
    );
    test('dois pedidos e um agradecimento: mantém os dois', () => {
      expect(mensagens(['manda o pix da Rua de Teste', 'e o da Avenida de Teste', 'obrigado'])).toEqual(so(['301', '302']));
    });
    test.each([
      ['troca pra Avenida de Teste'], ['é a Avenida de Teste'], ['Avenida de Teste, 30'], ['muda pra Avenida de Teste'],
      ['é a outra casa'], ['a outra'], ['não é essa'], ['errado'], ['e como faço pra pagar?'], ['manda logo por favor'],
      ['obrigado, não tenho outra dúvida'],
    ])('%j depois do pedido (dois contratos): nem o pedido antigo é forçado nem os outros liberados — dúvida de endereço só do turno', (fala) => {
      expect(mensagens(['manda o pix da Rua de Teste', fala])).toEqual(DUVIDA_DO_TURNO);
    });
    test.each([['não sei pagar pelo app'], ['obrigado, não tenho outra dúvida'], ['e como faço pra pagar?']])(
      '%j depois do pedido, com um contrato só: mantém (não há o que ampliar), sem dúvida gravada', (fala) => {
        expect(mensagens(['manda o pix da Rua de Teste', fala], { enderecos: UM_SO })).toEqual(so(['301']));
      },
    );
    test.each([['deixa, não precisa mais'], ['esquece'], ['Esquece, obrigado'], ['cancela'], ['não quero mais'], ['depois eu vejo'], ['Deixa pra lá']])(
      '%j depois do pedido: nenhuma autorização para entregar no turno, sem dúvida gravada', (fala) => {
        expect(mensagens(['manda o pix da Rua de Teste', fala])).toEqual(DESISTIU);
      },
    );
    test('a desistência continua valendo depois de um agradecimento; um pedido novo pela rua a substitui', () => {
      expect(mensagens(['manda o pix da Rua de Teste', 'deixa, não precisa', 'obrigado'])).toEqual(DESISTIU);
      expect(mensagens(['manda o pix da Rua de Teste', 'deixa', 'manda o da Avenida de Teste'])).toEqual(so(['302']));
    });
    test('desistência depois de um pedido sem rua (um contrato só): também não deixa autorização', () => {
      expect(mensagens(['manda o pix', 'esquece'], { enderecos: UM_SO })).toEqual(DESISTIU);
    });
    // Revisão da rodada 9 (achado 2): o pedido de cobrança com palavra de desistência não é desistência.
    test.each([['não quero boleto, quero pix'], ['me manda o pix, depois eu vejo o boleto'], ['deixa eu te perguntar, manda o pix'], ['não precisa do boleto, manda só o pix']])(
      '%j (um contrato só): é pedido, não desistência', (fala) => {
        expect(mensagens([fala], { enderecos: UM_SO })).toEqual(NADA);
      },
    );
    test('depois de um pedido no lote, o pedido de cobrança com palavra de desistência continua pedido (não trava)', () => {
      expect(mensagens(['manda o pix da Rua de Teste', 'não precisa do boleto, manda só o pix'], { enderecos: UM_SO })).toEqual(so(['301']));
      expect(mensagens(['manda o pix', 'não quero boleto, quero pix'], { enderecos: UM_SO })).toEqual(NADA);
    });
    test('a dúvida do turno é desfeita por uma nova escolha pela rua no mesmo lote', () => {
      expect(mensagens(['manda o pix da Rua de Teste', 'troca pra Avenida de Teste', 'é o da Avenida de Teste'])).toEqual(so(['302']));
    });
    test('a palavra de desistência sem pedido de cobrança antes no lote não trava nada', () => {
      expect(mensagens(['Deixa pra lá'])).toEqual(NADA);
      expect(mensagens(['oi, tudo bem?', 'esquece'])).toEqual(NADA);
    });
    test('sem pedido pela rua antes, a fala não classificada não cria nada', () => {
      expect(mensagens(['é a outra casa'])).toEqual(NADA);
    });
  });
});
