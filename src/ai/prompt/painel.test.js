const painel = require('./painel');
const { estadoBase } = require('./estado-de-teste');

describe('módulo painel', () => {
  test('entra sempre, independente do estado', () => {
    expect(painel.entra(estadoBase())).toBe(true);
  });

  test('lista os setores com o aiHint quando existe, e sem traço quando não existe', () => {
    const texto = painel.linhas(estadoBase({
      setores: [
        { id: 's1', name: 'Suporte', aiHint: 'internet com problema' },
        { id: 's2', name: 'Comercial', aiHint: null },
      ],
    })).join('\n');
    expect(texto).toContain('- s1 = Suporte — internet com problema');
    expect(texto).toContain('- s2 = Comercial');
    expect(texto).not.toContain('s2 = Comercial —');
  });

  test('lista os motivos pelo id e nome exatos', () => {
    const texto = painel.linhas(estadoBase({
      motivos: [{ id: 'r1', name: 'Lentidão' }, { id: 'r2', name: 'Sem acesso' }],
    })).join('\n');
    expect(texto).toContain('- r1 = Lentidão');
    expect(texto).toContain('- r2 = Sem acesso');
  });

  test('com instruções adicionais, mostra o cabeçalho de precedência e o texto do painel verbatim', () => {
    const texto = painel.linhas(estadoBase({
      config: { systemPrompt: 'p', triageExtraInstructions: 'Planos: 500 Mega R$ 100', triageResolvedReasonId: null },
    })).join('\n');
    expect(texto).toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO — única fonte de preço, planos, cobertura, promoções e documentação/);
    expect(texto).toMatch(/vale o princípio acima/);
    expect(texto).toContain('Planos: 500 Mega R$ 100');
  });

  test('sem instruções adicionais, diz que preço e cobertura são sempre com o setor comercial', () => {
    const texto = painel.linhas(estadoBase({
      config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: null },
    })).join('\n');
    expect(texto).toContain('Não há instruções adicionais da operação: preço, planos e cobertura são sempre com o setor comercial.');
    expect(texto).not.toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO —/);
  });
});
