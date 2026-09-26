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
      expect(t).toMatch(/AVISO ATIVO PARA Viseu: Rompimento de fibra na região, equipe já está a caminho\./);
    });

    // Ajuste (25/09/2026): UM aviso por turno. Com o aviso já enviado ao cliente neste turno, o
    // fato continua no prompt, mas o modelo é instruído a não repetir a ocorrência.
    test('aviso já enviado neste turno: o fato continua, e a instrução é não repetir a ocorrência', () => {
      const t = avisoCidade.linhas(estadoBase({ avisoCidade: { cidade: 'Viseu', mensagem: 'Falha na rede.', enviadoNesteTurno: true } })).join(' ');
      expect(t).toMatch(/AVISO ATIVO PARA Viseu: Falha na rede\./);
      expect(t).toMatch(/JÁ FOI ENVIADO ao cliente agora/);
      expect(texto()).not.toMatch(/JÁ FOI ENVIADO/);
    });

    test('suprime verificação de equipamento e promessa de previsão', () => {
      const t = texto();
      expect(t).toMatch(/NÃO peça verificações de equipamento, NÃO prometa previsão/);
    });

    // Task 18 — antes: ai-orchestrator.test.js:1860. A empresa já sabe da
    // falha: o cliente precisa OUVIR que existe uma falha regional em
    // andamento na cidade dele, não só deixar de receber o roteiro normal.
    test('diz ao cliente que há falha regional em andamento na cidade dele, usando o aviso', () => {
      const t = texto();
      expect(t).toMatch(/informe que há uma falha regional em andamento nesse local \(use o aviso acima\)/);
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

// P1-1 da auditoria final (25/09/2026): o aviso NÃO explica suspensão — a mesma regra das
// ferramentas de status. A exceção vai sempre (o cliente pode ser identificado no meio do turno);
// com contrato suspenso já conhecido, a frase "sem acesso → falha regional" nem aparece.
describe('aviso-cidade: o aviso não explica suspensão', () => {
  const AVISO = { cidade: 'Cândido Mendes', mensagem: 'Falha regional em andamento.' };
  const texto = (extra) => avisoCidade.linhas(estadoBase({ avisoCidade: AVISO, ...extra })).join('\n');

  test('sem contrato conhecido: a exceção da suspensão vai junto da regra do aviso', () => {
    const t = texto({});
    expect(t).toMatch(/informe que há uma falha regional/);
    expect(t).toMatch(/Contrato SUSPENSO não é falha regional/);
  });

  test('com o contrato suspenso: nada manda atribuir a falta de acesso ao aviso', () => {
    const t = texto({ contratos: [{ id: 3, status: 'suspenso', endereco: 'RUA Z, 3' }] });
    expect(t).not.toMatch(/informe que há uma falha regional/);
    expect(t).toMatch(/consta SUSPENSO/);
    expect(t).toMatch(/roteiro do contrato suspenso/);
  });

  test('um suspenso e um ativo: sem saber de qual contrato ele fala, não aponta causa única', () => {
    const t = texto({ contratos: [{ id: 3, status: 'suspenso', endereco: 'RUA Z, 3' }, { id: 5, status: 'ativo', endereco: 'RUA X, 10' }] });
    expect(t).toMatch(/RUA Z, 3/);
    expect(t).toMatch(/pergunte de qual endereço/);
    expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
  });

  test('só contratos ativos: a regra do aviso de sempre', () => {
    const t = texto({ contratos: [{ id: 5, status: 'ativo', endereco: 'RUA X, 10' }] });
    expect(t).toMatch(/informe que há uma falha regional/);
  });
});
