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
