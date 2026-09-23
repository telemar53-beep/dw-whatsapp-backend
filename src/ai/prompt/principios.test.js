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

  // =====================================================================
  // Task 18 — asserts migrados de ai-orchestrator.test.js
  // =====================================================================
  // Cada teste abaixo guarda a lição de um print real de produção que o
  // construtor antigo protegia com um assert de texto literal.
  describe('regras migradas do construtor antigo (Task 18)', () => {
    const texto = () => principios.linhas(estadoBase()).join('\n');

    // Antes: ai-orchestrator.test.js:652 e :1241-1242 (lacuna 3 das 7 do
    // despacho). Teste real 2026-09-13 (Suporte): o modelo escreveu "vou
    // encaminhar para o Suporte" e não chamou concluir_triagem — só encaminhou
    // no turno seguinte, depois de um "OK" do cliente. Print 2026-09-16: pediu
    // "me encaminhe a mensagem da promoção" E concluiu no mesmo turno, então a
    // imagem que a cliente mandou em seguida ficou sem ninguém para ler.
    test('encaminhar e pedir algo são turnos diferentes: concluir_triagem vai junto do aviso, nunca junto de um pedido', () => {
      const t = texto();
      expect(t).toMatch(/Quando decidir encaminhar, chame concluir_triagem NA MESMA resposta em que avisa\./);
      expect(t).toMatch(/Nunca escreva "vou encaminhar" sem concluir, e nunca espere um "ok" para encaminhar\./);
      expect(t).toMatch(/Nunca conclua no mesmo turno em que pede algo ao cliente: ou você pergunta, ou você encaminha\./);
    });

    // Antes: ai-orchestrator.test.js:1135-1136. Prints 2026-09-16: encaminhar
    // tinha virado a saída padrão para tudo o que a IA não sabia resolver, e o
    // cliente saía sem resposta nenhuma.
    test('nunca encaminha deixando a pergunta do cliente sem resposta', () => {
      expect(texto()).toMatch(/Nunca encaminhe deixando a pergunta dele sem resposta: responda primeiro, e só então diga que está encaminhando\./);
    });

    // Antes: ai-orchestrator.test.js:1341-1342. Print 2026-09-17 (16:56):
    // entrega de boleto inteira sem chamar a cliente pelo nome, logo depois de
    // identificar pelo CPF. Palavras do dono: "está muito robô".
    test('usa o primeiro nome assim que o conhece, e continua usando', () => {
      const t = texto();
      expect(t).toMatch(/Assim que souber o primeiro nome do cliente, use-o na resposta seguinte e de vez em quando depois\./);
      expect(t).toMatch(/Entregar algo sem nunca chamar a pessoa pelo nome soa robótico\./);
    });

    // Antes: ai-orchestrator.test.js:1367-1368. Print 2026-09-17 (16:05-16:06):
    // a mesma pergunta de diagnóstico saiu três vezes seguidas, mesmo com o
    // cliente respondendo "Lentidão" no meio. A regra manda CONFERIR quatro
    // fontes antes de perguntar qualquer coisa — é isso que quebra o laço.
    test('antes de perguntar, confere mensagem atual, histórico, cadastro e ferramentas', () => {
      const t = texto();
      expect(t).toMatch(/Antes de perguntar qualquer coisa, confira: a mensagem atual, o histórico, o que você já sabe do cliente e o que as ferramentas devolveram\./);
      expect(t).toMatch(/Perguntar o que ele acabou de dizer é o pior erro de atendimento que existe\./);
    });

    // Antes: ai-orchestrator.test.js:1248. Print 2026-09-16: "não trabalho com
    // promoções aqui na triagem" — o cliente ouviu o organograma em vez da
    // resposta. Os exemplos são o que dá liga à regra.
    test('a proibição de expor o funcionamento interno vem com os exemplos que o print produziu', () => {
      const t = texto();
      expect(t).toMatch(/nada de "aqui na triagem", "meu sistema", "minha ferramenta"/);
      expect(t).toMatch(/Fale do que você pode fazer, não de como funciona por dentro\./);
    });

    // Antes: ai-orchestrator.test.js:1384. A proibição de data de nascimento
    // já tem guarda acima; o que faltava era a cláusula que o print de
    // 2026-09-17 (17:53) produziu — a IA pediu a data "para conferir o
    // comprovante", uma situação que a regra genérica não fechava sozinha.
    test('a proibição de data de nascimento cobre explicitamente a conferência de comprovante', () => {
      const t = texto();
      expect(t).toMatch(/nem para identificar, nem para conferir comprovante, nem para "seguir com a conferência"/);
      expect(t).toMatch(/O CPF já identifica\./);
    });

    // Antes: ai-orchestrator.test.js:1484. A guarda de emoji acima trava as
    // duas pontas (onde pode, onde não pode); esta trava o miolo, que é o que
    // o dono ampliou em 2026-09-15: ícone por plano e 👍 no endereço.
    // 2026-09-22: a despedida entrou na lista. O roteiro comercial passou a
    // responder a um agradecimento com "Por nada 😊 Se quiser seguir com a
    // instalação, é só me chamar." — e despedida não era nem saudação nem
    // encaminhamento, então as duas regras se contradiriam no mesmo prompt.
    // Duas palavras aqui, só no ramo de vendas; PIX, boleto e suporte intactos.
    test('no fluxo de vendas, o emoji vai além da saudação: despedida, ícone por plano e 👍 ao confirmar o endereço', () => {
      expect(texto()).toMatch(/No fluxo de vendas: um 😊 na saudação, no encaminhamento ou na despedida, um ícone por plano se as instruções trouxerem, e 👍 ao confirmar o endereço\./);
    });

    // Antes: ai-orchestrator.test.js:1817 e :1822 (lacunas 4 e 2 das 7 do
    // despacho). Tom pedido pelo dono depois dos testes reais de 2026-09-13
    // (recepcionista simpática, não telegrama) e a regra de uma mensagem só,
    // que o 2º teste real do boleto produziu: o modelo escrevia a própria
    // frase e colava o modelo logo abaixo, com o mesmo sentido.
    test('tom caloroso e direto, uma mensagem por resposta, exemplos para adaptar e não para colar', () => {
      const t = texto();
      expect(t).toMatch(/Tom: caloroso e direto, como uma recepcionista simpática\./);
      expect(t).toMatch(/Frases completas\. Uma mensagem por resposta\./);
      expect(t).toMatch(/Os exemplos de frase são base para adaptar, nunca texto para colar\./);
    });

    // Antes: ai-orchestrator.test.js:1516 — e a inversão deliberada do
    // assert :1514. A regra antiga ("NUNCA diga ao cliente que não conseguiu
    // verificar... a EMPRESA é o suporte") empurrava o modelo a INVENTAR um
    // resultado para não admitir a falha. A spec inverteu: o proibido é
    // inventar, não é admitir. O que sobrevive é a segunda metade — responder
    // com o que está confirmado, encaminhar, e registrar o que faltou.
    test('consulta que falha: nunca inventa resultado, nunca diz que verificou, e o que faltou vai para o resumo', () => {
      const t = texto();
      expect(t).toMatch(/Se uma consulta que você precisava falhar: nunca invente o resultado e nunca diga que verificou o que não verificou\./);
      expect(t).toMatch(/Responda com o que estiver confirmado, encaminhe se for o caso, e escreva o que faltou no resumo interno\./);
      expect(t).toMatch(/Não exponha erro técnico ao cliente\./);
      // A regra antiga não pode voltar: ela proibia justamente a honestidade.
      expect(t).not.toMatch(/NUNCA diga ao cliente que não conseguiu verificar/);
    });

    // Antes: ai-orchestrator.test.js:1194-1195 reforçado — a guarda existente
    // trava a primeira metade da linha; esta trava a segunda, que é a que
    // resolve o caso concreto (a última mensagem do cliente traz uma pergunta).
    test('quando a última mensagem traz uma pergunta, ela é respondida na mesma mensagem em que se encaminha', () => {
      expect(texto()).toMatch(/Se a última mensagem dele traz uma pergunta, responda-a na mesma mensagem em que encaminha\./);
    });

    // Antes: ai-orchestrator.test.js:733 reforçado. "Uma pergunta por vez" tem
    // uma exceção que o roteiro comercial depende: bairro e rua são o MESMO
    // objetivo e vão juntos. Sem ela, a regra vira três turnos para um endereço.
    test('uma pergunta por vez, com a exceção de dados do mesmo objetivo', () => {
      expect(texto()).toMatch(/Uma pergunta por vez\. Dados do mesmo objetivo podem ir juntos \("seu bairro e sua rua"\); uma lista de campos, nunca\./);
    });
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
