// Conclusão do atendimento (04/10/2026): o validador de horário e promessa sem evidência. Puro, sem banco.
const { promessasSemEvidencia, respostaSemPromessas, SEM_INFORMACAO_CONFIRMADA } = require('./promessas-sem-evidencia');

describe('promessas-sem-evidencia', () => {
  describe('horário e prazo em horas', () => {
    test.each([
      'Nosso atendimento funciona hoje até as 18h.',
      'Atendemos das 8h às 18h.',
      'O suporte abre às 08:00.',
      'Volto a falar com você às 14h30.',
      'Pode levar até 72 horas para compensar.',
      'Em 2 horas resolve.',
    ])('"%s" sem fonte: horário sem fonte', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual(['horario_sem_fonte']);
    });

    test('o horário que um fato do sistema trouxe (retorno da equipe no modo noturno) fica, nas grafias comuns', () => {
      for (const t of ['Nossa equipe dá continuidade a partir das 08:00.', 'Nossa equipe volta às 8h.', 'A partir das 8:00 a equipe confere.']) {
        expect(promessasSemEvidencia(t, { horariosConfirmados: ['08:00'] })).toEqual([]);
      }
      expect(promessasSemEvidencia('Nossa equipe volta às 9h.', { horariosConfirmados: ['08:00'] })).toEqual(['horario_sem_fonte']);
    });

    // Revisão (04/10/2026): o horário ou prazo escrito no prompt do turno (aviso de cidade, instruções do painel, fatos)
    // tem fonte — não sai.
    test('o horário ou o prazo que está no texto com fonte (o prompt do turno) fica; outro horário sai', () => {
      const fonte = 'AVISO DA CIDADE: instabilidade na rede, previsão de normalização às 18h. Compensação em até 72 horas.';
      expect(promessasSemEvidencia('A previsão de normalização é às 18h.', { textoComFonte: fonte })).toEqual([]);
      expect(promessasSemEvidencia('A previsão é 18:00.', { textoComFonte: fonte })).toEqual([]);
      expect(promessasSemEvidencia('Pode levar até 72 horas para compensar.', { textoComFonte: fonte })).toEqual([]);
      expect(promessasSemEvidencia('A previsão é às 19h.', { textoComFonte: fonte })).toEqual(['horario_sem_fonte']);
      expect(promessasSemEvidencia('Pode levar até 48 horas.', { textoComFonte: fonte })).toEqual(['horario_sem_fonte']);
    });

    test.each([
      'O boleto vence dia 10/10 e o valor é R$ 89,90.',
      'Seu protocolo é 20261004-0001.',
      'A liberação vale por 3 dias.',
      'O plano é de 600 mega.',
      'Valor R$ 240,00.',
    ])('"%s": não é horário', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual([]);
    });
  });

  describe('promessa de trabalho futuro da IA', () => {
    test.each([
      'Vou tentar novamente com o financeiro.',
      'Vou tentar de novo daqui a pouco.',
      'Tentarei outra vez.',
      'Te retorno assim que tiver novidade.',
      'Vou te avisar quando conseguir.',
      'Fico acompanhando o seu caso.',
      'Estou tentando encaminhar seu atendimento.',
    ])('"%s": promessa da IA', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual(['promessa_da_ia']);
    });

    test.each([
      'Se quiser, me peça de novo que eu tento outra vez.',
      'Se você me escrever de novo, eu tento novamente.',
      'Caso queira, pode me pedir de novo por aqui.',
    ])('"%s": oferta condicionada ao cliente fica', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual([]);
    });

    test.each([
      'Se não der certo, vou tentar de novo mais tarde.',
      'Caso a equipe não responda, vou tentar novamente.',
      'Se quiser, eu te aviso quando a equipe responder.',
      'Se preferir, fico acompanhando o seu caso.',
      'Se quiser, vou tentar de novo mais tarde.',
    ])('"%s": condição que não é um pedido do cliente, adiamento ou retorno que nenhum mecanismo cumpre: sai', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual(['promessa_da_ia']);
    });

    test.each([
      'Se você quiser, vou tentar de novo agora.',
      'Se você me pedir, vou tentar novamente.',
      'Caso queira, vou tentar outra vez.',
    ])('"%s": nova tentativa que depende de um pedido do cliente fica', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual([]);
    });

    // Pendências do atendimento (04/10/2026): verificar "quando o pagamento constar" é trabalho futuro sem mecanismo.
    test.each([
      'Assim que o pagamento constar no sistema, vou verificar a situação do contrato.',
      'Assim que o pagamento constar no sistema, a situação do contrato será verificada.',
      'Assim que compensar, vou conferir seu contrato.',
      'Quando o pagamento constar no sistema, vou verificar a situação do contrato.',
      'Logo que o pagamento constar, vou verificar o contrato.',
      // Revisão do incremento (04/10/2026): passado e pedido DEPOIS da promessa não são passo do cliente.
      'Assim que o pagamento que você enviou for compensado, vou verificar a liberação.',
      'Assim que o PIX que você me mandou cair, vou conferir o seu contrato.',
      'Assim que o pagamento constar, vou conferir; me chama aqui se precisar.',
      // Comportamento da IA (05/10/2026; conferência estreita das pendências): o agradecimento pelo que ele já fez não é
      // pedido; um pedido em outra oração (";") não condiciona a verificação; e "eu confiro" no presente é promessa futura.
      'Obrigado por me enviar o comprovante, assim que o pagamento constar vou verificar a liberação.',
      'Você acabou de me enviar o comprovante, e assim que o pagamento constar vou conferir o contrato.',
      'Me avise se tiver dúvida; assim que o pagamento constar, vou verificar o contrato.',
      'Assim que o pagamento constar, eu confiro a liberação.',
      'Quando o pagamento cair, eu verifico seu contrato.',
      // Revisão do delta (05/10/2026): "já" antes do verbo do gatilho não tira a promessa.
      'Assim que o pagamento já constar, eu confiro a liberação.',
      // Conferência estreita (05/10/2026): agradecimento com "de" ou com "você" também não é pedido.
      'Obrigado por lembrar de me enviar o comprovante, assim que o pagamento constar vou verificar a liberação.',
      'Agradeço a gentileza de me enviar o comprovante, assim que o pagamento constar eu confiro.',
      'Você acabou agora de me enviar o comprovante, e assim que o pagamento constar vou conferir.',
      'Obrigado por você me enviar o comprovante, assim que o pagamento constar vou verificar a liberação.',
    ])('"%s": verificação futura sem mecanismo sai', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual(['promessa_da_ia']);
    });

    test.each([
      'Depois de pagar, me avise por aqui que eu confiro o pagamento no sistema.',
      'Assim que você me mandar o comprovante, eu confiro.',
      'Assim que o pagamento for feito, me avise por aqui que eu vou conferir.',
      'Assim que o PIX cair, me manda o comprovante que vamos verificar.',
      // Comportamento da IA (05/10/2026): o pedido na mesma oração continua valendo, e a frase segura do sistema fica.
      'Quando o pagamento constar, me avise que eu confiro.',
      'Assim que o pagamento for feito, me avise; eu vou conferir por aqui.',
      'Quando quiser, eu confiro o pagamento por aqui.',
      // Revisão do delta (05/10/2026): "não deixe de me mandar" é pedido (só "por me" e "acabou de me" agradecem); e o
      // pagamento no passado ("quando o pix foi feito") é o que o cliente fez, não o gatilho de constar no sistema.
      'Não deixe de me mandar o comprovante assim que o pagamento for feito, que eu vou conferir.',
      'Me diga quando o pix foi feito, que eu confiro.',
      'Me diga quando o PIX já foi feito, que eu confiro.',
      // Conferência estreita (05/10/2026): pedido com "de" que não é agradecimento, pedido depois do agradecimento
      // separado por vírgula, e os pedidos "me diga/informe/confirme".
      'Tenha a gentileza de me enviar o comprovante assim que o pagamento for feito, que eu vou conferir.',
      'Obrigado pela paciência, me avise quando o pagamento for feito que eu confiro.',
      'Me diga quando o pix for feito, que eu confiro.',
      'Me informe quando o pagamento for feito, que eu confiro.',
      'Me confirme quando o pix for feito, que eu verifico.',
      // Sem verbo de pedido: só o passado ("foi", "já foi") tira o gatilho.
      'Obrigado por avisar quando o pix foi feito, eu confiro por aqui.',
      'Você disse quando o PIX já foi feito, então eu confiro agora.',
    ])('"%s": próximo passo que depende do cliente fica', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual([]);
    });

    test('a promessa da IA sai mesmo com o encaminhamento confirmado: nenhum trabalho da IA é agendado', () => {
      expect(promessasSemEvidencia('Vou tentar novamente depois.', { encaminhamentoConfirmado: true })).toEqual(['promessa_da_ia']);
    });
  });

  describe('promessa de ação da equipe', () => {
    test.each([
      'Um atendente vai entrar em contato com você.',
      'Um atendente vai responder por aqui assim que estiver disponível.',
      'Nossa equipe vai conferir o pagamento.',
      'Sua solicitação será tratada por um atendente.',
      'Você será atendido em breve.',
    ])('"%s" sem encaminhamento confirmado: sai', (t) => {
      expect(promessasSemEvidencia(t, {})).toEqual(['promessa_da_equipe']);
    });

    test('"a equipe responsável vai orientar…" (uma palavra entre equipe e o verbo) também é promessa da equipe', () => {
      expect(promessasSemEvidencia('Há mais de uma fatura em atraso e a equipe responsável vai orientar a regularização.', {})).toEqual(['promessa_da_equipe']);
      expect(promessasSemEvidencia('Há mais de uma fatura em atraso e a equipe responsável vai orientar a regularização.', { encaminhamentoConfirmado: true })).toEqual([]);
    });

    test('com o encaminhamento confirmado neste turno, a promessa da equipe fica (a conversa está na fila)', () => {
      expect(promessasSemEvidencia('Um atendente vai responder por aqui assim que estiver disponível.', { encaminhamentoConfirmado: true })).toEqual([]);
    });
  });

  describe('respostaSemPromessas', () => {
    test('sai só a frase que não pode sair; o resto fica', () => {
      expect(respostaSemPromessas('Não consegui agora. Vou tentar novamente com o financeiro. Posso ajudar em algo mais?', {}))
        .toBe('Não consegui agora. Posso ajudar em algo mais?');
    });

    test('sem nada que sobre: a frase do chamador, ou a de que não há informação confirmada', () => {
      expect(respostaSemPromessas('Atendemos das 8h às 18h.', {})).toBe(SEM_INFORMACAO_CONFIRMADA);
      expect(respostaSemPromessas('Vou tentar novamente.', { seNadaSobrar: 'Frase do chamador.' })).toBe('Frase do chamador.');
    });

    // Revisão (04/10/2026): a pergunta de horário não fica sem resposta — no lugar da frase cujo único problema é o horário
    // sem fonte, entra a de que não há informação confirmada (uma vez).
    test('a frase só com horário sem fonte dá lugar à de que não há informação confirmada; o resto fica', () => {
      expect(respostaSemPromessas('Funcionamos até as 18h. Posso ajudar em algo mais?', {}))
        .toBe(SEM_INFORMACAO_CONFIRMADA + ' Posso ajudar em algo mais?');
      expect(respostaSemPromessas('Abrimos às 8h. Fechamos às 18h. Posso ajudar?', {})).toBe(SEM_INFORMACAO_CONFIRMADA + ' Posso ajudar?');
    });

    test('a frase que também promete (horário e promessa) sai sem substituta: vale a frase do chamador', () => {
      expect(respostaSemPromessas('Um atendente vai te responder às 14h.', { seNadaSobrar: 'Frase do chamador.' })).toBe('Frase do chamador.');
    });

    test('resposta sem nada a retirar sai igual', () => {
      const t = 'Enviei acima o boleto. Se tiver alguma dificuldade, me avise que eu te ajudo!';
      expect(respostaSemPromessas(t, {})).toBe(t);
    });
  });
});
