const terceiros = require('./terceiros');
const { estadoBase } = require('../estado-de-teste');

describe('módulo terceiros', () => {
  test('entra sempre, independente do estado', () => {
    expect(terceiros.entra(estadoBase())).toBe(true);
  });

  // Testes do brief da Task 13 (Step 1), literais.
  test('terceiros entra em qualquer estado e nunca pede outro dado além do documento', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(terceiros.entra(estadoBase())).toBe(true);
    expect(texto).toMatch(/CPF( ou CNPJ)? do titular/i);
    expect(texto).not.toMatch(/nascimento|parentesco|nome da mãe/i);
  });

  test('terceiros avisa que plano, conexão e status do titular não podem ser consultados', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/plano.*conex|conex.*plano/i);
  });

  test('também avisa que situação financeira e liberação/desbloqueio não podem ser feitos no contrato do titular', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toContain('situação financeira e liberação ou desbloqueio desse contrato NÃO podem ser consultados nem executados');
  });

  test('aceita CPF ou CNPJ do titular (limite novo da Task 7)', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/CPF ou CNPJ/);
  });

  test('pode consultar a fatura e entregar boleto ou PIX do titular', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toContain('você pode consultar a fatura e entregar o boleto ou o PIX dele');
  });

  test('chama buscar_cliente com titularEOutraPessoa: true', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/chame buscar_cliente com titularEOutraPessoa: true/);
  });

  // Task 18 — antes: ai-orchestrator.test.js:1222. Decisão do dono
  // (2026-09-16): a segunda via no site do SGP sai só com o CPF, então pedir o
  // boleto do marido é atendimento normal. O rótulo é o que diz ao modelo que
  // este caso é a EXCEÇÃO à recusa de privacidade que vem logo acima.
  test('o rótulo abre dizendo que fatura, boleto ou PIX de outra pessoa é atendimento normal', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/FATURA, BOLETO OU PIX DE OUTRA PESSOA é atendimento normal, não interrogatório/);
  });

  // Task 18 — antes: ai-orchestrator.test.js:1402. Print 2026-09-17: "o boleto
  // da cliente [nome]" + CPF → a IA respondeu chamando quem estava falando
  // pelo nome do titular. Citar o nome de outra pessoa JÁ é pedido de
  // terceiro, mesmo sem o cliente dizer isso com todas as letras.
  test('citar o NOME de outra pessoa junto com o pedido já é pedido de terceiro', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/Se ele citar o NOME de outra pessoa junto com o pedido, isso também é pedido de terceiro: passe titularEOutraPessoa: true\./);
  });

  test('nunca diz "seu contrato" nem "sua fatura", e diz de quem é o boleto ao entregar', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toContain('NUNCA diga "seu contrato" nem "sua fatura" nesse caso');
    expect(texto).toContain('ao entregar, diga de quem é (o boleto ou o PIX)');
  });

  test('quem fala continua chamado pelo próprio nome, nunca pelo nome do titular', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toContain('Continue chamando quem está falando pelo próprio nome dele, nunca pelo nome do titular.');
  });

  test('a autorização vale por tempo limitado e, expirada, exige o CPF do titular de novo', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/vale só por um tempo e só para esta conversa/);
    expect(texto).toMatch(/se ela expirar, peça o CPF ou CNPJ do titular de novo/);
  });

  test('nunca contém nome real de cliente (só marcador)', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).not.toMatch(/Laureny/);
    expect(texto).not.toMatch(/Jureildson/);
    expect(texto).toContain('[nome]');
  });

  test('nunca nomeia um setor fixo como string literal', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
  });

  // Rodada de correção 1 da Task 20 (execução real, 2026-09-18): a instrução
  // de não concluir a triagem logo depois de entregar existia só em
  // fluxos/financeiro.js, que NÃO entra no estado do fluxo de terceiro
  // (identidade.nivel === 'none'). Na execução real o modelo entregou o
  // boleto do titular e concluiu a triagem no mesmo turno. Os dois testes
  // abaixo são os dois lados: com motivo de encerramento configurado a linha
  // aparece; sem ele, nada muda.
  const COM_MOTIVO = () => estadoBase({
    config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: '[motivo]' },
  });

  test('com motivo de encerramento configurado, manda NÃO concluir a triagem e esperar para encerrar', () => {
    const texto = terceiros.linhas(COM_MOTIVO()).join('\n');
    expect(texto).toContain('NÃO conclua a triagem nesse momento');
    expect(texto).toMatch(/chame encerrar_atendimento/);
    // A linha fala do fluxo de QUEM PEDIU, não do titular.
    expect(texto).toMatch(/espere quem está falando confirmar ou agradecer/);
    expect(texto).toMatch(/Se ele pedir outra coisa, siga a triagem normalmente\./);
  });

  test('sem motivo de encerramento configurado, a linha não entra (segue concluindo)', () => {
    const texto = terceiros.linhas(estadoBase()).join('\n');
    expect(texto).not.toContain('NÃO conclua a triagem nesse momento');
    expect(texto).not.toMatch(/encerrar_atendimento/);
  });

  // A linha nova é varrida pelas mesmas guardas do módulo: sem palavra
  // proibida e sem nome de setor fixo.
  test('a linha nova respeita as guardas do módulo (dado proibido e nome de setor)', () => {
    const texto = terceiros.linhas(COM_MOTIVO()).join('\n');
    expect(texto).not.toMatch(/nascimento|parentesco|nome da mãe/i);
    expect(texto).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
  });
});
