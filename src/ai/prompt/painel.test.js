const painel = require('./painel');
const { estadoBase } = require('./estado-de-teste');

describe('módulo painel', () => {
  test('entra sempre, independente do estado', () => {
    expect(painel.entra(estadoBase())).toBe(true);
  });

  // Task 18 — duas das 7 lacunas apontadas pelo despacho (regra presente no
  // compositor, sem teste). A LISTAGEM de setores e motivos já era testada
  // abaixo; os CABEÇALHOS, não. São eles que dizem ao modelo o contrato de
  // concluir_triagem: o id EXATO da lista (não o nome do setor, que o modelo
  // inventaria) e, para o motivo, que null é uma resposta válida — sem isso
  // ele escolhe um motivo errado só para preencher o campo.
  test('os cabeçalhos mandam usar o id exato, e o de motivos admite null', () => {
    const texto = painel.linhas(estadoBase()).join('\n');
    expect(texto).toContain('Setores (use o id exato em concluir_triagem):');
    expect(texto).toContain('Motivos (use o id exato, ou null se nenhum se aplica):');
  });

  test('cada cabeçalho vem imediatamente antes da sua própria lista', () => {
    const texto = painel.linhas(estadoBase({
      setores: [{ id: 's1', name: 'Suporte', aiHint: null }],
      motivos: [{ id: 'r1', name: 'Lentidão' }],
    })).join('\n');
    const cabecalhoSetores = texto.indexOf('Setores (use o id exato');
    const cabecalhoMotivos = texto.indexOf('Motivos (use o id exato');
    expect(cabecalhoSetores).toBeLessThan(texto.indexOf('- s1 = Suporte'));
    expect(texto.indexOf('- s1 = Suporte')).toBeLessThan(cabecalhoMotivos);
    expect(cabecalhoMotivos).toBeLessThan(texto.indexOf('- r1 = Lentidão'));
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
    // Task 18 — antes: ai-orchestrator.test.js:713. Os dois textos são
    // mutuamente exclusivos: com instruções cadastradas, a frase de "não há
    // instruções" não pode sobrar no prompt ao lado delas, ou o modelo lê as
    // duas e manda o cliente para o setor de vendas mesmo tendo a resposta.
    expect(texto).not.toMatch(/Não há instruções adicionais da operação/);
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

describe('painel com as ferramentas comerciais disponiveis', () => {
  const COM_FERRAMENTAS = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];

  function texto(extra) {
    return painel.linhas(estadoBase(extra)).join('\n');
  }

  test('declara a ferramenta como fonte oficial de preco e cobertura', () => {
    const t = texto({ ferramentas: COM_FERRAMENTAS });

    expect(t).toMatch(/FONTE OFICIAL DO COMERCIAL/);
    expect(t).toMatch(/consultar_planos/);
    expect(t).toMatch(/verificar_cobertura/);
  });

  test('a ferramenta prevalece sobre o que o cliente disse e sobre as instrucoes', () => {
    const t = texto({ ferramentas: COM_FERRAMENTAS });

    expect(t).toMatch(/prevalece/i);
    expect(t).toMatch(/cliente disse ter ouvido/i);
  });

  // O ponto do lote: instrucoes vazias NAO podem mais significar "nao sei
  // preco". Com a ferramenta no ar, ela sabe.
  test('sem instrucoes adicionais, NAO diz mais que nao tem como confirmar', () => {
    const t = texto({ ferramentas: COM_FERRAMENTAS, config: { ...estadoBase().config, triageExtraInstructions: null } });

    expect(t).not.toMatch(/você não tem como confirmar sozinha/);
    expect(t).toMatch(/FONTE OFICIAL DO COMERCIAL/);
  });

  test('sem ferramenta comercial, o fallback antigo continua igual', () => {
    const t = texto({ ferramentas: ['buscar_cliente', 'concluir_triagem'] });

    expect(t).toMatch(/você não tem como confirmar sozinha/);
    expect(t).not.toMatch(/FONTE OFICIAL DO COMERCIAL/);
  });

  test('as instrucoes salvas continuam saindo inteiras, so deixam de ser "unica fonte de preco"', () => {
    const t = texto({
      ferramentas: COM_FERRAMENTAS,
      config: { ...estadoBase().config, triageExtraInstructions: 'Texto que o dono escreveu.' },
    });

    expect(t).toContain('Texto que o dono escreveu.');
    expect(t).toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO/);
    expect(t).not.toMatch(/única fonte de preço/);
    expect(t).toMatch(/preço, planos e cobertura vêm das ferramentas/i);
  });

  test('sem ferramenta comercial, o cabecalho antigo das instrucoes e preservado', () => {
    const t = texto({
      ferramentas: ['buscar_cliente'],
      config: { ...estadoBase().config, triageExtraInstructions: 'Texto que o dono escreveu.' },
    });

    expect(t).toMatch(/única fonte de preço/);
  });

  test('so uma das duas disponivel nao anuncia a outra', () => {
    const t = texto({ ferramentas: ['buscar_cliente', 'consultar_planos'] });

    expect(t).toMatch(/consultar_planos/);
    expect(t).not.toMatch(/verificar_cobertura/);
  });
});
