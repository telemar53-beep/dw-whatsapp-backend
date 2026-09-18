const privacidade = require('./privacidade');
const { estadoBase } = require('../estado-de-teste');

describe('módulo privacidade', () => {
  test('entra sempre, independente do estado', () => {
    expect(privacidade.entra(estadoBase())).toBe(true);
  });

  // Teste do brief da Task 13 (Step 1), literal.
  test('privacidade entra em qualquer estado', () => {
    for (const nivel of ['none', 'forte']) expect(privacidade.entra(estadoBase({ identidade: { nivel } }))).toBe(true);
  });

  test('recusa dado de outra pessoa (senha do Wi-Fi, dado cadastral, endereço) e não encaminha', () => {
    const texto = privacidade.linhas(estadoBase()).join('\n');
    expect(texto).toContain('DADOS DE OUTRA PESSOA');
    expect(texto).toContain('NUNCA são passados e NUNCA viram chamado');
    expect(texto).toContain('Não consigo passar dados de outro cliente, nem a senha da rede dele — só o titular pode informar isso.');
  });

  test('se insistir em falar com atendente, o resumo começa identificando o pedido de dado de outra pessoa', () => {
    const texto = privacidade.linhas(estadoBase()).join('\n');
    expect(texto).toContain('Pedido de dado de outra pessoa; recusado na triagem');
  });

  test('relatar problema do vizinho não é pedido de dado: atende o relato normalmente', () => {
    const texto = privacidade.linhas(estadoBase()).join('\n');
    expect(texto).toContain('Relatar problema do vizinho ("o roteador dele está com luz vermelha", "ele me pediu para falar com vocês") NÃO é pedido de dado: atenda o relato normalmente.');
  });

  test('a senha da própria rede do cliente, do contrato dele, é pedido legítimo e não é recusada', () => {
    const texto = privacidade.linhas(estadoBase()).join('\n');
    expect(texto).toContain('a senha da rede DELE mesmo, do contrato dele, é pedido legítimo — nunca recuse.');
  });

  test('nunca contém nome real de cliente nem cita data de nascimento', () => {
    const texto = privacidade.linhas(estadoBase()).join('\n');
    expect(texto).not.toMatch(/Laureny/);
    expect(texto).not.toMatch(/Jureildson/);
    expect(texto).not.toMatch(/nascimento/i);
  });

  test('nunca nomeia um setor fixo como string literal', () => {
    const texto = privacidade.linhas(estadoBase()).join('\n');
    expect(texto).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
  });
});
