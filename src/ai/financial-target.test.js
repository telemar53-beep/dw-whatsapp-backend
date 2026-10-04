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
