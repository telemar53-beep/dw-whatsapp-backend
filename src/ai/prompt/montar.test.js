const { montarContexto, MODULOS } = require('./montar');
const { estadoBase } = require('./estado-de-teste');

test('a ordem de montagem começa pelo prompt do sistema e põe os princípios em seguida', () => {
  const texto = montarContexto(estadoBase());
  expect(texto.indexOf('Você é a assistente da empresa.')).toBe(0);
  expect(texto.indexOf('PRIORIDADE')).toBeGreaterThan(0);
  expect(texto.indexOf('PRIORIDADE')).toBeLessThan(texto.indexOf('Setores'));
});

test('as instruções da operação vêm com a frase de precedência no cabeçalho', () => {
  const texto = montarContexto(estadoBase({
    config: { systemPrompt: 'p', triageExtraInstructions: 'Planos: 500 Mega R$ 100', triageResolvedReasonId: null },
  }));
  expect(texto).toContain('Planos: 500 Mega R$ 100');
  const cabecalho = texto.slice(texto.indexOf('INSTRUÇÕES ADICIONAIS') - 400, texto.indexOf('Planos: 500'));
  expect(cabecalho).toMatch(/vale o princípio/i);
});

test('cliente não identificado não recebe nenhum roteiro de cliente identificado', () => {
  const texto = montarContexto(estadoBase());
  expect(texto).not.toMatch(/consultar_status_todos_contratos/);
  expect(texto).not.toMatch(/REATIVAÇÃO/);
});

test('cliente identificado não recebe a abertura de cliente novo', () => {
  const texto = montarContexto(estadoBase({
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
    contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }],
  }));
  expect(texto).not.toMatch(/bloco de planos das instruções/);
});

// Este teste olha a SELEÇÃO, não o conteúdo: privacidade e terceiros são os dois
// módulos que entram em qualquer estado de identidade. O texto deles é a tarefa
// seguinte — aqui eles ainda são esqueleto, então asserir a frase faria a Task 12
// ter de escrever conteúdo da Task 13 e acabaria duplicando o bloco nos dois lugares.
test('privacidade e terceiros são selecionados nos dois estados de identidade', () => {
  const privacidade = MODULOS.find((m) => m.nome === 'privacidade');
  const terceiros = MODULOS.find((m) => m.nome === 'terceiros');
  for (const nivel of ['none', 'forte']) {
    const estado = estadoBase({ identidade: { nivel, origem: 'phone', primeiroNome: '[nome]', contracts: [], contestado: false } });
    expect(privacidade.entra(estado)).toBe(true);
    expect(terceiros.entra(estado)).toBe(true);
  }
});

test('todo módulo declara nome, entra e linhas', () => {
  for (const m of MODULOS) {
    expect(typeof m.nome).toBe('string');
    expect(typeof m.entra).toBe('function');
    expect(typeof m.linhas).toBe('function');
  }
});
