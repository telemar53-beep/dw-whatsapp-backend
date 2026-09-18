const avisoCidade = require('./aviso-cidade');
const { estadoBase } = require('../estado-de-teste');

describe('módulo aviso-cidade', () => {
  describe('entra()', () => {
    // Teste literal do brief/plano da Task 17 (Step 1, adaptado do test.each combinado).
    test('entra só com aviso de cidade ativo', () => {
      expect(avisoCidade.entra(estadoBase())).toBe(false);
      expect(avisoCidade.entra(estadoBase({ avisoCidade: { cidade: 'X', mensagem: 'falha' } }))).toBe(true);
    });

    test('não entra com avisoCidade null explícito', () => {
      expect(avisoCidade.entra(estadoBase({ avisoCidade: null }))).toBe(false);
    });

    test('não depende de identidade — entra mesmo com cliente não identificado', () => {
      const estado = estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
        avisoCidade: { cidade: 'Cândido Mendes', mensagem: 'Falha regional em andamento.' },
      });
      expect(avisoCidade.entra(estado)).toBe(true);
    });
  });

  describe('conteúdo', () => {
    const texto = (cidade = 'Cândido Mendes', mensagem = 'Falha regional em andamento na região.') =>
      avisoCidade.linhas(estadoBase({ avisoCidade: { cidade, mensagem } })).join('\n');

    test('cita a cidade e a mensagem do aviso, interpolados', () => {
      const t = texto('Viseu', 'Rompimento de fibra na região, equipe já está a caminho.');
      expect(t).toMatch(/AVISO ATIVO NA CIDADE DO CLIENTE \(Viseu\): Rompimento de fibra na região, equipe já está a caminho\./);
    });

    test('suprime verificação de equipamento e promessa de previsão', () => {
      const t = texto();
      expect(t).toMatch(/NÃO peça verificações de equipamento, NÃO prometa previsão/);
    });

    test('resumo cita "falha regional" e conclui para o setor da lista acima que cuidar de suporte', () => {
      const t = texto();
      expect(t).toMatch(/conclua para o setor da lista acima que cuidar de suporte na mesma resposta com "falha regional" no resumo/);
    });

    test('assunto diferente de falha é atendido normalmente, sem forçar o roteiro de aviso', () => {
      const t = texto();
      expect(t).toMatch(/Se o assunto for outro, atenda normalmente\./);
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo)', () => {
      const t = texto();
      expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
      expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
    });

    test('nunca contém nome real de cliente, preço ou velocidade real', () => {
      const t = texto();
      expect(t).not.toMatch(/Willemberg/);
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
    });
  });
});
