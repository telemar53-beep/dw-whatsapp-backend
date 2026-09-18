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
  // em código. Os exemplos usam marcador.
  test('exemplo de leitura de sentido usa marcador, não velocidade/preço real', () => {
    const texto = principios.linhas(estadoBase()).join('\n');
    expect(texto).toContain('[velocidade]');
    expect(texto).toContain('[valor]');
  });

  // Rodada de correção 3 (dono, 2026-09-18): a guarda geral de dado
  // operacional (velocidade, preço, nome de setor) que morava aqui só
  // cobria principios.js — se um módulo de fluxo reintroduzisse isso nas
  // Tasks 13-17, nada pegava. Ela SE MUDOU para montar.test.js, onde varre
  // TODOS os módulos de uma vez (menos painel.js, que repassa dado do
  // operador por natureza). Ver o teste "nenhum módulo... hardcoda
  // velocidade, preço ou nome de setor" lá.

  // Rodada de correção 2 da Task 17 (coordenador, 2026-09-18): três regras
  // GERAIS (proibição de nascimento, fim de roteiro não automático, regra
  // de emoji) sumiram em silêncio na migração — existiam só como comentário
  // em fatos.js/comercial-novo.js, nunca chegaram a ser emitidas pelo
  // compositor. Medido pelo coordenador comparando baseline × compositor
  // nos três cenários (emite 1, compositor emitia 0). Já sumiram uma vez
  // sem que nenhum teste pegasse — esta guarda trava as três para não
  // sumirem de novo.
  describe('guarda contra as três regras gerais que já sumiram uma vez (Rodada de correção 2, Task 17)', () => {
    const texto = () => principios.linhas(estadoBase()).join('\n');

    test('proíbe pedir data de nascimento, em qualquer situação', () => {
      expect(texto()).toMatch(/NUNCA peça data de nascimento ao cliente, em nenhuma situação/);
    });

    test('fim de roteiro não é automático', () => {
      expect(texto()).toMatch(/Fim de roteiro NÃO é automático: só conclua quando não houver mais nada para responder\./);
    });

    test('o resumo ao concluir é para o atendente', () => {
      expect(texto()).toMatch(/Ao concluir, o resumo é para o atendente: o que o cliente quer e o que você apurou\./);
    });

    test('regra de emoji: só PIX e vendas, nenhum emoji em boleto/suporte/outros assuntos', () => {
      const t = texto();
      expect(t).toMatch(/Emoji SÓ nos fluxos de PIX e de vendas\./);
      expect(t).toMatch(/No BOLETO, no suporte e em qualquer outro assunto, NENHUM emoji — nem na saudação\./);
    });

    // A adaptação de "COMERCIAL"/"SUPORTE" para "vendas"/"suporte" não pode
    // reintroduzir nome de setor fixo (Restrição Global do plano) — mesma
    // categoria que a guarda de montar.test.js varre em todos os módulos de
    // fluxo; aqui, direto, porque principios.js é um caso à parte (não está
    // na lista MODULOS de fluxos/, mas entra na varredura geral de
    // montar.test.js do mesmo jeito, por incluir 'principios' em MODULOS).
    test('a regra de emoji não nomeia um setor fixo (maiúsculo ou minúsculo)', () => {
      const t = texto();
      expect(t).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
      expect(t).not.toMatch(/\b(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/);
    });
  });
});
