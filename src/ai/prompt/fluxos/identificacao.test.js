const identificacao = require('./identificacao');
const { estadoBase } = require('../estado-de-teste');

describe('módulo identificacao', () => {
  describe('entra()', () => {
    test('entra quando a identidade ainda não foi confirmada (nivel none)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      });
      expect(identificacao.entra(estado)).toBe(true);
    });

    test('entra quando a identidade foi contestada, mesmo com nivel diferente de none', () => {
      // Combinação hipotética: na prática, esquecer_identificacao sempre
      // zera nivel para 'none' junto com contestado: true (tool-registry.js)
      // — os dois nunca se separam hoje. Mas o contrato de entra() é a UNIÃO
      // dos dois estados, não só o caso observado; testando nos dois
      // sentidos, inclusive esta combinação que hoje não ocorre na prática.
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: true },
      });
      expect(identificacao.entra(estado)).toBe(true);
    });

    test('NÃO entra com identidade forte e sem contestação', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
      });
      expect(identificacao.entra(estado)).toBe(false);
    });

    test('NÃO entra com SGP indisponível (identidade forte pela memória, sem contestação)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(identificacao.entra(estado)).toBe(false);
    });
  });

  describe('conteúdo', () => {
    test('pede CPF/CNPJ só quando o pedido depende de localizar o cadastro, sem nomear setor', () => {
      const texto = identificacao.linhas(estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      })).join('\n');
      expect(texto).toMatch(/Peça o CPF ou CNPJ só quando o que ele pediu depender de localizar o cadastro dele/);
      expect(texto).toMatch(/Quem só quer conhecer planos ou contratar não precisa se identificar\./);
      expect(texto).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
    });

    // Task 18 — antes: ai-orchestrator.test.js:1312. Redação reescrita pelo
    // dono em 2026-09-17: a frase seca ("me informe seu CPF") tinha virado
    // padrão e soava impessoal. O pedido acolhe antes de pedir o documento, e
    // diz para que serve.
    test('o pedido do documento acolhe antes de pedir, e diz para que serve', () => {
      const texto = identificacao.linhas(estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      })).join('\n');
      expect(texto).toContain('"Vou verificar isso para você. Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor."');
    });

    // Task 18 — antes: ai-orchestrator.test.js:776. Depois de buscar_cliente
    // a triagem CONTINUA: identificar não é o fim do atendimento.
    test('depois de buscar_cliente, a triagem continua', () => {
      const texto = identificacao.linhas(estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      })).join('\n');
      expect(texto).toMatch(/Depois de buscar_cliente, continue a triagem\./);
    });

    test('sem contestação, não soma o aviso de identificação descartada', () => {
      const texto = identificacao.linhas(estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      })).join('\n');
      expect(texto).not.toMatch(/identificação foi descartada/);
    });

    test('identidade contestada soma o aviso de identificação descartada', () => {
      const texto = identificacao.linhas(estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: true },
      })).join('\n');
      expect(texto).toMatch(/O cliente disse que o nome anterior não era dele: a identificação foi descartada\. Peça o CPF\./);
    });

    test('nunca reintroduz data de nascimento, identidade fraca ou gate de confiança', () => {
      const texto = identificacao.linhas(estadoBase()).join('\n');
      expect(texto).not.toMatch(/nascimento/i);
      expect(texto).not.toMatch(/identidade fraca/i);
      expect(texto).not.toMatch(/gate de confiança/i);
    });
  });
});
