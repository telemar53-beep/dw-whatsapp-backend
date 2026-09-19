const multiplosContratos = require('./multiplos-contratos');
const { estadoBase } = require('../estado-de-teste');

describe('módulo multiplos-contratos', () => {
  describe('entra()', () => {
    // Teste literal do brief/plano da Task 17 (Step 1).
    test('múltiplos contratos entra só com mais de um contrato', () => {
      expect(multiplosContratos.entra(estadoBase({ contratos: [{ id: 1 }] }))).toBe(false);
      expect(multiplosContratos.entra(estadoBase({ contratos: [{ id: 1 }, { id: 2 }] }))).toBe(true);
    });

    test('não entra sem nenhum contrato', () => {
      expect(multiplosContratos.entra(estadoBase({ contratos: [] }))).toBe(false);
    });

    test('entra com três ou mais contratos', () => {
      const estado = estadoBase({ contratos: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      expect(multiplosContratos.entra(estado)).toBe(true);
    });
  });

  // O módulo fica intencionalmente sem conteúdo — ver o comentário completo em
  // multiplos-contratos.js. Resumo: a desambiguação por endereço (a âncora
  // textual deste módulo, segundo a spec e o plano) já está inteira e
  // incondicionalmente em fatos.js desde a Task 12 (ai-orchestrator.js:376-380),
  // e a desambiguação específica de pagamento já está em financeiro.js desde a
  // Task 16 (ai-orchestrator.js:399). Migrar de novo aqui duplicaria a mesma
  // instrução no prompt montado toda vez que houvesse mais de um contrato.
  describe('conteúdo', () => {
    test('linhas() vazio quando entra() é true — nada a acrescentar ao que fatos.js e financeiro.js já dizem', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }, { id: 2 }], contestado: false },
        contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }, { id: 2, plano: 'Y', status: 'suspenso', endereco: 'Rua B' }],
      });
      expect(multiplosContratos.entra(estado)).toBe(true);
      expect(multiplosContratos.linhas(estado)).toEqual([]);
    });
  });
});
