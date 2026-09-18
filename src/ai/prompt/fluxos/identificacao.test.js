const identificacao = require('./identificacao');
const { estadoBase } = require('../estado-de-teste');

// BLOQUEADO (Task 14, 2026-09-18) — ver header do módulo e task-14-report.md
// para o achado completo. Resumo: o conteúdo que o brief pede para linhas()
// ("Cliente NÃO identificado. Peça o CPF/CNPJ" + a linha de contestação) já
// existe, revisado e aprovado, em fatos.js (ramo identidade.nivel === 'none')
// — selecionado no MESMO estado em que este módulo entraria. Preenchê-lo
// aqui do jeito que o brief pede duplicaria a instrução; mover o conteúdo de
// fatos.js está fora do escopo desta tarefa. Só entra() está pronto: é
// inequívoco (contrato dado pelo brief) e não depende da decisão pendente.
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
      // zera nivel para 'none' junto com contestado: true (tool-registry.js,
      // ramo do esquecer_identificacao) — os dois nunca se separam hoje. Mas
      // o contrato de entra() dado pela tarefa é a UNIÃO dos dois estados,
      // não só o caso observado; testando nos dois sentidos como pedido,
      // inclusive esta combinação que hoje não ocorre na prática.
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

  describe('linhas() — BLOQUEADO, ver task-14-report.md', () => {
    test('fica vazio até a divergência com fatos.js ser resolvida (não duplica conteúdo)', () => {
      expect(identificacao.linhas(estadoBase())).toEqual([]);
    });
  });
});
