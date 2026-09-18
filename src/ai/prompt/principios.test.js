const principios = require('./principios');
const { estadoBase } = require('./estado-de-teste');

describe('módulo principios', () => {
  test('entra sempre, independente do estado', () => {
    expect(principios.entra(estadoBase())).toBe(true);
    expect(principios.entra(estadoBase({ identidade: null }))).toBe(true);
  });

  test('declara a hierarquia de prioridade de 1 a 8, do topo pra baixo', () => {
    const texto = principios.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/PRIORIDADE — quando duas regras conflitarem, vale a de cima/);
    for (const item of [
      '1. Segurança e privacidade.',
      '2. A intenção da mensagem mais recente do cliente.',
      '3. Os fatos que você já sabe',
      '4. Os resultados das ferramentas.',
      '5. Resolver o que ele pediu.',
      '6. Coletar só o que for indispensável para o próximo passo.',
      '7. Encaminhar quando precisar de gente.',
      '8. O estilo da resposta.',
    ]) {
      expect(texto).toContain(item);
    }
  });

  test('instruções adicionais da operação não sobrepõem os itens 1 a 4', () => {
    const texto = principios.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/INSTRUÇÕES ADICIONAIS DA OPERAÇÃO mandam em preço, planos, cobertura e política comercial, mas não sobrepõem os itens 1 a 4/);
  });

  test('usa o nome da empresa do estado na abertura, com fallback genérico', () => {
    const comEmpresa = principios.linhas(estadoBase({ empresa: 'Provedor Teste' })).join('\n');
    expect(comEmpresa).toContain('Você é a primeira atendente virtual da Provedor Teste.');

    const semEmpresa = principios.linhas(estadoBase({ empresa: null })).join('\n');
    expect(semEmpresa).toContain('Você é a primeira atendente virtual da empresa.');
  });

  test('não repetir pergunta, mensagem mais recente manda e nunca citar funcionamento interno', () => {
    const texto = principios.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/NUNCA repita uma pergunta que ele já respondeu/);
    expect(texto).toMatch(/A mensagem mais recente manda/);
    expect(texto).toMatch(/NUNCA cite o funcionamento interno/);
  });

  // Rodada de correção 2 (dono, 2026-09-18): o exemplo de leitura de sentido
  // tinha "600 mega" e "135" — velocidade e preço reais desta operação escritos
  // em código. Guarda travada aqui para os módulos seguintes também: nenhuma
  // velocidade (número + "mega") nem preço (R$ + número) pode nascer dentro de
  // um módulo. Dado operacional como isso só pode vir das INSTRUÇÕES ADICIONAIS
  // DA OPERAÇÃO (config.triageExtraInstructions), nunca hardcoded.
  test('nunca hardcoda velocidade ou preço real: os exemplos usam marcador', () => {
    const texto = principios.linhas(estadoBase()).join('\n');
    expect(texto).not.toMatch(/\d+\s*mega/i);
    expect(texto).not.toMatch(/R\$\s*\d/);
    expect(texto).toContain('[velocidade]');
    expect(texto).toContain('[valor]');
  });
});
