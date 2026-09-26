const financeiro = require('./financeiro');
const { estadoBase } = require('../estado-de-teste');

describe('módulo financeiro', () => {
  describe('entra()', () => {
    test('NÃO entra sem identidade confirmada', () => {
      expect(financeiro.entra(estadoBase())).toBe(false);
    });

    test('entra com identidade forte', () => {
      expect(financeiro.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });

    // Rodada de correção 1 da Task 17 (coordenador, 2026-09-18): mesma
    // correção já aplicada a suporte-diagnostico.js, estendida aqui — com o
    // SGP fora do ar, fatos.js manda não tentar boleto, PIX nem status, e
    // este módulo faz exatamente isso.
    test('NÃO entra com SGP indisponível, mesmo com identidade forte', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(financeiro.entra(estado)).toBe(false);
    });

    test('entra com identidade forte quando sgpIndisponivel é false ou ausente', () => {
      expect(financeiro.entra(estadoBase({ identidade: { nivel: 'forte', sgpIndisponivel: false } }))).toBe(true);
      expect(financeiro.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const identificado = (extra = {}) => estadoBase({
      identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
      contratos: [{ id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço]', status: 'ativo' }],
      ...extra,
    });
    const texto = (extra) => financeiro.linhas(identificado(extra)).join('\n');

    test('pedido de pagamento tem prioridade sobre diagnóstico', () => {
      const t = texto();
      expect(t).toMatch(/PEDIDO DE PAGAMENTO/);
      expect(t).toMatch(/tem prioridade sobre qualquer roteiro de diagnóstico/);
      expect(t).toMatch(/NUNCA pergunte "você chegou a fazer esse pagamento\?" a quem acabou de dizer que quer pagar/);
      // Task 18 — antes: ai-orchestrator.test.js:1352. Print 2026-09-17
      // (16:32): a entrega tem de sair AGORA, inclusive com o contrato
      // suspenso — a pendência é justamente o que ele está resolvendo.
      expect(t).toMatch(/entregue o boleto ou o PIX AGORA \(enviar_boleto ou gerar_pix\), mesmo com o contrato suspenso — a pendência é justamente o que ele está resolvendo\./);
    });

    test('identidade já confirmada: não pede CPF, entrega direto por ferramenta', () => {
      const t = texto();
      expect(t).toMatch(/NÃO peça CPF/);
      expect(t).toMatch(/enviar_boleto ou gerar_pix/);
    });

    test('sem motivo de encerramento configurado, sempre conclui para o financeiro depois de entregar', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: null } });
      expect(t).toMatch(/entregue com enviar_boleto ou gerar_pix e depois conclua a triagem para o setor da lista acima que cuidar do financeiro/);
    });

    describe('com motivo de encerramento configurado (triageResolvedReasonId)', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });

      test('não conclui a triagem no momento da entrega', () => {
        expect(t).toMatch(/NÃO conclua a triagem nesse momento/);
      });

      test('a frase de entrega vem do retorno da ferramenta, nunca de um texto fixo do prompt', () => {
        expect(t).toMatch(/responda EXATAMENTE no modelo que a ferramenta devolver no campo instrucao/);
        expect(t).toMatch(/NUNCA diga que enviou o boleto ou o PIX antes de a ferramenta confirmar o envio/);
      });

      test('despedida usa marcador de nome, nunca o nome real', () => {
        expect(t).toMatch(/Imagina, \[nome\]! 😊 Qualquer dúvida/);
        expect(t).toMatch(/Imagina, \[nome\]! Qualquer dúvida…/);
        expect(t).not.toMatch(/Willemberg/);
      });

      test('despedida do boleto não tem emoji; a das demais tem', () => {
        expect(t).toMatch(/No fluxo do BOLETO as mesmas despedidas valem, mas SEM emoji/);
      });

      test('encerra também quando o cliente só confirma com "ok" ou joinha', () => {
        expect(t).toMatch(/Se responder só "ok", "certo" ou um joinha: chame encerrar_atendimento/);
      });

      // Task 18 — antes: ai-orchestrator.test.js:1813. A despedida fecha o
      // atendimento de verdade: reabre a porta e deseja o dia, variando à
      // noite. Sem isso o "encerrar" sai seco.
      test('a despedida reabre a porta e varia entre dia e noite', () => {
        expect(t).toMatch(/pode chamar a gente por aqui\. Tenha um ótimo dia!/);
        expect(t).toMatch(/\(à noite, "Tenha uma boa noite!"\)/);
      });

      // Task 18 — antes: ai-orchestrator.test.js:1809-1811. Teste real
      // 2026-09-15 (produção): com o exemplo "Enviei acima o boleto..." no
      // prompt, o modelo copiou a frase sem chamar enviar_boleto e o cliente
      // não recebeu nada. Os modelos de frase da ENTREGA saíram do prompt de
      // propósito — quem devolve o texto é a própria ferramenta, depois de
      // ter enviado. Nenhum pode voltar, nem com nome real de cliente junto.
      test('nenhum modelo de frase de entrega vive no prompt, nem nome real de cliente', () => {
        expect(t).not.toMatch(/Enviei acima o PIX/);
        expect(t).not.toMatch(/Enviei acima o boleto/);
        expect(t).not.toMatch(/Agenor Costa/);
      });

      // Task 18 — antes: ai-orchestrator.test.js:1823. Com motivo configurado
      // a IA ENCERRA; a instrução de encaminhar ao financeiro depois de
      // entregar é do outro ramo e não pode sobrar aqui, ou o modelo lê as
      // duas e faz as duas coisas.
      test('com motivo, a instrução de encaminhar depois de entregar não sobra no prompt', () => {
        expect(t).not.toMatch(/e depois conclua a triagem para o setor da lista acima que cuidar do financeiro/);
      });
    });

    // Task 18 — antes: ai-orchestrator.test.js:1840. O espelho do teste
    // acima: sem motivo configurado, encerrar_atendimento não pode ser
    // oferecido em lugar nenhum deste módulo.
    test('sem motivo de encerramento, o módulo nunca manda encerrar o atendimento', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: null } });
      expect(t).not.toMatch(/chame encerrar_atendimento/);
    });

    test('pedido de boleto/PIX com mais de um contrato só aparece com mais de um contrato', () => {
      const doisContratos = texto({
        contratos: [
          { id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço 1]', status: 'ativo' },
          { id: 2, plano: '[plano]', velocidade: null, endereco: '[endereço 2]', status: 'suspenso' },
        ],
      });
      expect(doisContratos).toMatch(/Pedido de boleto ou PIX com mais de um contrato/);
      expect(doisContratos).toMatch(/consultar_faturas_todos_contratos ANTES de perguntar qualquer coisa/);

      const umContrato = texto();
      expect(umContrato).not.toMatch(/Pedido de boleto ou PIX com mais de um contrato/);
    });

    // Task 18 — antes: ai-orchestrator.test.js:1083, :1833 e :1834. 1º teste
    // real com dois contratos: o modelo gastou as duas perguntas ("qual
    // contrato", "qual endereço") e encaminhou sem mandar o PIX que já podia
    // mandar. A ferramenta decide: se só um tem fatura, entrega sem perguntar;
    // se mais de um, UMA pergunta pelo endereço — com emoji no PIX e sem no
    // boleto, como manda a regra de emoji de principios.js.
    test('com dois contratos, a consulta decide: um só entrega direto, mais de um pede o endereço uma vez', () => {
      const t = texto({
        contratos: [
          { id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço 1]', status: 'ativo' },
          { id: 2, plano: '[plano]', velocidade: null, endereco: '[endereço 2]', status: 'suspenso' },
        ],
      });
      expect(t).toMatch(/Se só um contrato tiver fatura em aberto, entregue dele sem perguntar\./);
      expect(t).toMatch(/Claro, vou te ajudar com o PIX 😊 Vi que você tem mais de um contrato com a gente\./);
      expect(t).toMatch(/Para BOLETO, o mesmo pedido sem emoji: "Claro, vou te ajudar com o boleto\. Vi que você tem mais de um contrato com a gente\./);
    });

    test('sem fatura em aberto em nenhum contrato: avisa sem valor e conclui sem perguntar', () => {
      const t = texto();
      expect(t).toMatch(/Se a ferramenta responder que não há fatura em aberto em nenhum contrato/);
      expect(t).toMatch(/não pergunte se ele quer ser encaminhado/);
      expect(t).toMatch(/chame concluir_triagem para o setor da lista acima que cuidar do financeiro/);
      // Task 18 — antes: ai-orchestrator.test.js:732. O outro retorno da
      // ferramenta tem outro desfecho: com contratosComFatura, pergunta o
      // endereço e entrega na resposta seguinte, em vez de encaminhar.
      expect(t).toMatch(/Se ela devolver contratosComFatura, pergunte pelo endereço e entregue na resposta seguinte\./);
    });

    // Ajuste de 25/09/2026 (decisão do dono, que substitui a frase-modelo de antes): "o acesso é
    // liberado automaticamente" não é garantido — com duas ou mais vencidas, pagar uma não libera.
    test('cliente suspenso perguntando se a internet volta depois de pagar: sem promessa de liberação nem prazo', () => {
      const t = texto();
      expect(t).toMatch(/NÃO prometa que ela volta sozinha nem dê prazo/);
      expect(t).toMatch(/"Assim que o pagamento constar no sistema, vou verificar a situação do contrato\."/);
      expect(t).toMatch(/Pagamento confirmado sozinho não é liberação, e comprovante válido também não/);
      expect(t).not.toMatch(/liberad[oa] automaticamente|liberação é automática/);
    });

    // Regra 0/1/2+ (25/09/2026): a promessa de liberação automática vale só quando a cobrança pôde
    // sair (0 ou 1 vencida). Com 2+ vencidas ou contrato cancelado, pagar uma fatura não libera.
    test('a fatura que pode sair é decisão do sistema', () => {
      const t = texto();
      expect(t).toMatch(/Qual fatura pode ser enviada é decisão do sistema, não sua/);
      expect(t).toMatch(/não escolha outra fatura, não negocie e não tente outro contrato por conta própria/);
    });

    test('pagamento só se confirma por conferir_pagamento; liberação só com contrato ativo ou desbloqueio', () => {
      const t = texto();
      expect(t).toMatch(/chame conferir_pagamento: só ela confirma um pagamento/);
      expect(t).toMatch(/Comprovante, "já paguei" ou aviso do banco NÃO confirmam/);
      expect(t).toMatch(/nem assim diga que ela está conectada ou online/);
    });

    test('comprovante válido com a baixa pendente: o desbloqueio não espera a baixa e não vira "pagamento confirmado"', () => {
      const t = texto();
      expect(t).toMatch(/o desbloqueio em confiança, quando disponível, segue as regras dele e não espera a baixa/);
      expect(t).toMatch(/liberado em confiança enquanto o pagamento é processado — nunca que o pagamento foi confirmado/);
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo) como Financeiro', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
      expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
    });

    test('nunca contém nome real de cliente', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).not.toMatch(/Willemberg/);
    });

    test('nunca cita preço ou velocidade real, nem reintroduz nascimento/identidade fraca/gate de confiança', () => {
      const t = texto({ config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: 'r1' } });
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/nascimento/i);
      expect(t).not.toMatch(/identidade fraca/i);
      expect(t).not.toMatch(/gate de confiança/i);
    });
  });
});
