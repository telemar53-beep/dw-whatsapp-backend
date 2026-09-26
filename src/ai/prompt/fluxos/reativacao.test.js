const reativacao = require('./reativacao');
const { estadoBase } = require('../estado-de-teste');

describe('módulo reativacao', () => {
  describe('entra()', () => {
    test('NÃO entra sem identidade confirmada', () => {
      expect(reativacao.entra(estadoBase())).toBe(false);
    });

    test('entra com identidade forte', () => {
      expect(reativacao.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });

    // Rodada de correção 1 da Task 17 (coordenador, 2026-09-18): mesma
    // correção já aplicada a suporte-diagnostico.js, estendida aqui — com o
    // SGP fora do ar não há como saber há quantos dias uma fatura está
    // vencida, então este módulo não tem como decidir o roteamento.
    test('NÃO entra com SGP indisponível, mesmo com identidade forte', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(reativacao.entra(estado)).toBe(false);
    });

    test('entra com identidade forte quando sgpIndisponivel é false ou ausente', () => {
      expect(reativacao.entra(estadoBase({ identidade: { nivel: 'forte', sgpIndisponivel: false } }))).toBe(true);
      expect(reativacao.entra(estadoBase({ identidade: { nivel: 'forte' } }))).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const texto = () => reativacao.linhas(estadoBase({ identidade: { nivel: 'forte' } })).join('\n');

    test('o corte de negócio é 90 dias, contado pela fatura mais antiga a partir de hoje', () => {
      const t = texto();
      expect(t).toMatch(/mais de 90 dias/);
      expect(t).toMatch(/conte pela data de hoje/);
      expect(t).toMatch(/contrato já cancelado/);
      // Task 18 — antes: ai-orchestrator.test.js:1390. O corte anterior era
      // "DOIS meses ou mais em atraso"; o dono ajustou para 90 dias em
      // 2026-09-17. A redação antiga não pode voltar por cópia.
      expect(t).not.toMatch(/DOIS meses ou mais em atraso/);
    });

    test('até 90 dias continua sendo o financeiro; acima disso, o setor de reativação se existir, senão o financeiro', () => {
      const t = texto();
      expect(t).toMatch(/vai para o setor que cuidar de reativação ou retorno de clientes, se houver um na lista de setores acima/);
      expect(t).toMatch(/se não houver, vá para o que cuidar de financeiro/);
      expect(t).toMatch(/Até 90 dias continua sendo o setor da lista acima que cuidar do financeiro/);
    });

    test('promoção ou desconto para voltar: encaminha sem inventar valor', () => {
      const t = texto();
      expect(t).toMatch(/perguntar por promoção, condição especial ou desconto para voltar/);
      expect(t).toMatch(/nunca invente promoção, desconto ou valor/);
      expect(t).toMatch(/nunca diga que "não trabalha com promoções"/);
    });

    // Rodada de correção 1 (revisão do coordenador, 2026-09-18): "esse mesmo
    // setor cuida disso" tinha DOIS candidatos a antecedente na frase
    // imediatamente anterior (o setor de reativação da 1ª oração e o
    // financeiro da 2ª, mais perto) — ambiguidade que o original não tinha
    // (lá o nome do setor desambiguava por repetição). A oração de promoção
    // agora repete por extenso a MESMA descrição do setor da 1ª oração, sem
    // pronome solto apontando para trás.
    test('a frase de promoção repete a referência ao setor, sem pronome ambíguo', () => {
      const t = texto();
      expect(t).not.toMatch(/esse mesmo setor/);
      const oracaoPromocao = t.slice(t.indexOf('Se ele perguntar por promoção'));
      expect(oracaoPromocao).toMatch(/^Se ele perguntar por promoção, condição especial ou desconto para voltar, diga que o setor que cuidar de reativação ou retorno de clientes é quem trata disso e encaminhe para ele/);
    });

    test('não usa "REATIVAÇÃO" maiúsculo como rótulo de setor', () => {
      // Mesmo cuidado já registrado em comercial-novo.js (COMERCIAL -> VENDA) e
      // suporte-diagnostico.js (SUPORTE -> RELATO DE FALHA): a guarda de
      // montar.test.js é case-sensitive e "REATIVAÇÃO" em caixa alta como
      // cabeçalho escaparia da checagem "Reativação" (mista). Este módulo usa
      // a situação como rótulo ("MAIS DE 90 DIAS..."), nunca o nome do setor.
      expect(texto()).not.toMatch(/\bREATIVAÇÃO\b/);
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo) como Financeiro/Reativação', () => {
      const t = texto();
      expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
      expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
    });

    test('nunca cita preço ou velocidade real, nem reintroduz nascimento/identidade fraca/gate de confiança', () => {
      const t = texto();
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/nascimento/i);
      expect(t).not.toMatch(/identidade fraca/i);
      expect(t).not.toMatch(/gate de confiança/i);
    });

    test('nunca contém nome real de cliente', () => {
      expect(texto()).not.toMatch(/Willemberg/);
    });
  });
});

// Ajuste de 25/09/2026: a regra 0/1/2+ vem ANTES da regra dos 90 dias. Contrato cancelado, 2+
// vencidas de dia e o fluxo noturno de 2+ (depois da única cobrança permitida) são da reativação —
// o "até 90 dias continua sendo o financeiro" não pode mandá-los para o financeiro.
describe('regra 0/1/2+ antes da regra dos 90 dias', () => {
  const { montarContexto } = require('../montar');
  const FORTE = { nivel: 'forte', origem: 'phone', primeiroNome: 'Ana', contracts: [{ id: 1, statusCode: 4 }], contestado: false };
  const SETORES = [
    { id: 's-fin', name: 'Financeiro', aiHint: 'boleto, PIX' },
    { id: 's-reat', name: 'Reativação', aiHint: 'retorno de clientes' },
  ];

  test('sem marca: o "até 90 dias" cede à ferramenta de cobrança que indicar a reativação', () => {
    const t = reativacao.linhas(estadoBase({ identidade: FORTE })).join('\n');
    expect(t).toMatch(/Até 90 dias continua sendo o setor da lista acima que cuidar do financeiro, MENOS quando uma ferramenta de cobrança disser que há duas ou mais faturas vencidas ou que o contrato está cancelado, ou indicar o setor que cuida de reativação/);
    expect(t).toMatch(/essa regra vem antes da dos 90 dias/);
  });

  test.each(['contrato_cancelado', 'multiplas_vencidas', 'multiplas_vencidas_noturno'])(
    'conversa marcada (%s): nada manda para o financeiro por causa dos 90 dias', (motivo) => {
      const t = reativacao.linhas(estadoBase({ identidade: FORTE, reativacao: motivo })).join('\n');
      expect(t).not.toMatch(/Até 90 dias continua sendo/);
      expect(t).toMatch(/Esta conversa já está marcada para o setor que cuida de reativação/);
      expect(t).toMatch(/vêm antes da regra dos 90 dias/);
      expect(t).toMatch(/nunca no que cuida de financeiro/);
      expect(t).toMatch(/não envie outra cobrança/);
    }
  );

  test('a marca entra mesmo sem identidade forte (terceiro pagando a cobrança de outra pessoa)', () => {
    expect(reativacao.entra(estadoBase({ reativacao: 'multiplas_vencidas' }))).toBe(true);
  });

  test('no prompt montado inteiro, com a marca, a instrução de reativação vence as de financeiro', () => {
    const t = montarContexto(estadoBase({
      identidade: FORTE, contratos: [{ id: 1, status: 'suspenso', endereco: 'Rua A' }], setores: SETORES,
      ferramentas: ['enviar_boleto', 'gerar_pix', 'conferir_pagamento', 'concluir_triagem'], reativacao: 'multiplas_vencidas_noturno',
    }));
    expect(t).not.toMatch(/Até 90 dias continua sendo/);
    expect(t).toMatch(/Esta conversa já está marcada para o setor que cuida de reativação/);
    expect(t).toMatch(/vale acima de qualquer outra instrução deste texto que mande concluir no setor que cuida de financeiro/);
  });
});
