const comprovante = require('./comprovante');
const { estadoBase } = require('../estado-de-teste');

describe('módulo comprovante', () => {
  describe('entra()', () => {
    // Teste literal do brief/plano da Task 17 (Step 1).
    test('comprovante só entra quando a ferramenta está na lista do turno', () => {
      expect(comprovante.entra(estadoBase({ ferramentas: ['buscar_cliente'] }))).toBe(false);
      expect(comprovante.entra(estadoBase({ ferramentas: ['analisar_comprovante'] }))).toBe(true);
    });

    test('entra de dia ou de noite, contanto que a ferramenta esteja na lista', () => {
      const deDia = estadoBase({
        ferramentas: ['buscar_cliente', 'analisar_comprovante'],
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      });
      const deNoite = estadoBase({
        ferramentas: ['buscar_cliente', 'analisar_comprovante', 'desbloqueio_confianca'],
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      });
      expect(comprovante.entra(deDia)).toBe(true);
      expect(comprovante.entra(deNoite)).toBe(true);
    });
  });

  describe('conteúdo', () => {
    // Teste literal do brief/plano da Task 17 (Step 1).
    test('o comprovante de cliente não identificado pede o documento, nunca outro dado', () => {
      const texto = comprovante.linhas(estadoBase({ ferramentas: ['analisar_comprovante'] })).join('\n');
      expect(texto).toMatch(/CPF ou CNPJ/);
      expect(texto).not.toMatch(/nascimento|titularidade/i);
    });

    const comFerramenta = (extra = {}) => estadoBase({ ferramentas: ['buscar_cliente', 'analisar_comprovante'], ...extra });

    test('de noite, o texto é o COMPROVANTE À NOITE, com desbloqueio em confiança', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/COMPROVANTE À NOITE/);
      expect(t).toMatch(/desbloqueio_confianca/);
      expect(t).not.toMatch(/^COMPROVANTE:/m);
    });

    test('de dia, o texto é o COMPROVANTE diurno, sem desbloqueio em confiança', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/COMPROVANTE:/);
      expect(t).not.toMatch(/COMPROVANTE À NOITE/);
      expect(t).not.toMatch(/desbloqueio_confianca/);
    });

    test('a frase pós-execução do desbloqueio (EXATAMENTE) é a exceção legítima — só existe à noite', () => {
      const noite = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(noite).toMatch(/responda EXATAMENTE com a frase que ela devolver/);

      const dia = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: false }, forcarConclusao: false },
      })).join('\n');
      expect(dia).not.toMatch(/EXATAMENTE/);
    });

    test('nunca diz "pagamento confirmado" ou "acesso liberado" sem a ferramenta confirmar', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(t).toMatch(/NUNCA diga "pagamento confirmado" nem "acesso liberado" sem a ferramenta ter devolvido liberado: true/);
    });

    test('o motivo de comprovante é referenciado pela lista, nunca como nome fixo "Comprovante"', () => {
      for (const noturnoAtivo of [true, false]) {
        const t = comprovante.linhas(comFerramenta({
          triagem: { noturno: { ativo: noturnoAtivo, retornoAs: '08:00' }, forcarConclusao: false },
        })).join('\n');
        expect(t).toMatch(/o motivo da lista acima que falar de comprovante, se houver um/);
        expect(t).not.toMatch(/\bComprovante\b/);
      }
    });

    test('nunca nomeia um setor fixo (maiúsculo ou minúsculo) como Financeiro', () => {
      for (const noturnoAtivo of [true, false]) {
        const t = comprovante.linhas(comFerramenta({
          triagem: { noturno: { ativo: noturnoAtivo, retornoAs: '08:00' }, forcarConclusao: false },
        })).join('\n');
        expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
        expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
      }
    });

    test('nunca contém nome real de cliente, preço ou velocidade real', () => {
      const t = comprovante.linhas(comFerramenta({
        triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
      })).join('\n');
      expect(t).not.toMatch(/Willemberg/);
      expect(t).not.toMatch(/R\$\s*\d/);
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/nascimento/i);
    });
  });
});
