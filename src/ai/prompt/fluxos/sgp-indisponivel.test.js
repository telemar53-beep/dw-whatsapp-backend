const sgpIndisponivel = require('./sgp-indisponivel');
const fatos = require('../fatos');
const { estadoBase } = require('../estado-de-teste');

describe('módulo sgp-indisponivel', () => {
  describe('entra()', () => {
    test('não entra sem sgpIndisponivel', () => {
      expect(sgpIndisponivel.entra(estadoBase())).toBe(false);
    });

    test('entra com identidade.sgpIndisponivel true', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(sgpIndisponivel.entra(estado)).toBe(true);
    });

    test('não entra com sgpIndisponivel false explícito', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: false },
      });
      expect(sgpIndisponivel.entra(estado)).toBe(false);
    });

    test('não derruba com identidade ausente', () => {
      expect(sgpIndisponivel.entra({})).toBe(false);
    });
  });

  // Pendência 1 do despacho da Task 17: decidido e justificado no comentário
  // de sgp-indisponivel.js — fatos.js já cobre por completo o caso
  // (cumprimenta pela memória, proíbe boleto/PIX/status, manda encaminhar com
  // o resumo "SGP indisponível na triagem"). Este teste prova a decisão, não
  // só a documenta: confere que o texto que JUSTIFICARIA este módulo já está
  // presente no prompt montado por fatos.js, no mesmo estado em que
  // sgp-indisponivel.entra() seria true.
  describe('conteúdo', () => {
    const estado = estadoBase({
      identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
    });

    test('linhas() vazio quando entra() é true', () => {
      expect(sgpIndisponivel.entra(estado)).toBe(true);
      expect(sgpIndisponivel.linhas(estado)).toEqual([]);
    });

    test('fatos.js já entrega, sozinho, a instrução completa deste caso', () => {
      const textoFatos = fatos.linhas(estado).join('\n');
      expect(textoFatos).toMatch(/mas o sistema do SGP NÃO respondeu agora/);
      expect(textoFatos).toMatch(/NÃO peça CPF e NÃO tente boleto, PIX nem status de conexão/);
      expect(textoFatos).toMatch(/"SGP indisponível na triagem"/);
    });
  });
});
