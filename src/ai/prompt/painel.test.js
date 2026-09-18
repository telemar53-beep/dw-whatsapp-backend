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

  // Rodada de correção 3 (dono, 2026-09-18): a redação antiga dizia "são
  // sempre com o setor comercial" — nome de setor fixo, violando a Restrição
  // Global ("nomes de setor e motivo nunca aparecem como string literal").
  // O padrão certo é apontar para a lista de setores (que vem do banco, acima
  // no prompt), nunca nomear um setor que pode nem existir naquela operação.
  test('sem instruções adicionais, aponta para o setor da lista em vez de nomear "comercial"', () => {
    const linhas = painel.linhas(estadoBase({
      config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: null },
    }));
    const texto = linhas.join('\n');
    expect(texto).toContain('Não há instruções adicionais da operação: preço, planos e cobertura você não tem como confirmar sozinha — encaminhe para o setor da lista acima que cuidar de vendas e contratação.');
    expect(texto).not.toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO —/);
    // A checagem de nome de setor fixo é só na frase de fallback (a última
    // linha), não no texto inteiro: a listagem de setores acima LEGITIMAMENTE
    // repassa nomes que vêm do banco (ex.: "Suporte" no estadoBase padrão) —
    // ver a guarda completa, com essa mesma ressalva, em montar.test.js.
    const fraseDeFallback = linhas[linhas.length - 1];
    expect(fraseDeFallback).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
  });
});
