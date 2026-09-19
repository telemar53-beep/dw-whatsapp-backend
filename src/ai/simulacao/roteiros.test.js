// Os invariantes de um roteiro nem sempre são uma chamada direta a
// invariantes.js: alguns COMPÕEM (o recorte do último turno, a lista de
// ferramentas que contam como resolver, o "só julgue o resumo se houve
// handoff"). Composição também é código que decide aprovação, e vale a mesma
// regra do arquivo vizinho: os DOIS lados, com entrada fabricada.
//
// Sem este arquivo, trocar RESOLUCAO_DA_CONTA por uma lista errada, ou perder
// o ULTIMO no roteiro 10, passaria verde — o teste estrutural de
// simulacao-real.test.js só confere que o invariante é uma função.
//
// Escopo, de propósito: só os invariantes ALTERADOS que envolvem COMPOSIÇÃO —
// rodada de correção 1 da Task 20 (roteiros 10 e 19) e rodada de correção 2
// (roteiro 4, que reaproveita o recorte ULTIMO do roteiro 10). Os invariantes
// dos roteiros 17 e 21 que a correção 2 também mudou NÃO compõem nada (viraram
// uma chamada direta a recusouEOfereceuAlternativa) — a cobertura deles é em
// invariantes.test.js, e aqui fica só um teste de fiação confirmando que os
// dois roteiros usam a MESMA função, sem duplicar a correção.
//
// Nada aqui chama a OpenAI: as conversas são fabricadas à mão.

const { ROTEIROS } = require('./roteiros');
const { setorPorPapel } = require('./sgp-falso');

/** Turno mínimo, mesmo formato que conversar.js monta. */
function turno(extra = {}) {
  return {
    numero: 1, cliente: '', audio: false, texto: '',
    toolsExecutadas: [], toolsSolicitadas: [],
    triagemConcluida: null, atendimentoEncerrado: false, erro: null,
    ...extra,
  };
}

// O harness passa (turnos, resultado); só o roteiro 19 usa o segundo, para ler
// o limiar de confiança do painel.
const RESULTADO = { config: { triageConfidenceThreshold: 0.8 } };

/**
 * Roda UM invariante nomeado do roteiro, exatamente como simulacao-real.test.js
 * roda. A busca é pela DESCRIÇÃO: renomear o invariante quebra este teste de
 * propósito — é o aviso de que a composição mudou e precisa ser rejulgada.
 */
function verificar(numero, descricao, turnos) {
  const roteiro = ROTEIROS.find((r) => r.numero === numero);
  if (!roteiro) throw new Error(`roteiro ${numero} não existe`);
  const invariante = roteiro.invariantes[descricao];
  if (typeof invariante !== 'function') throw new Error(`o roteiro ${numero} não declara "${descricao}"`);
  return invariante(turnos, RESULTADO);
}

// Rodada de correção 2 da Task 20: o roteiro 4 tinha o MESMO defeito que o 10
// (naoPediuEndereco(ULTIMO(t)), que reprovava qualquer reaparição do
// endereço, mesmo como oferta) — só que a correção do 10 não tinha sido
// aplicada aqui. É o mesmo critério, reaproveitando o mesmo invariante.
describe('roteiro 4 — o preço responde antes de a IA voltar a oferecer o endereço', () => {
  const DESCRICAO = 'respondeu o preço antes de voltar a pedir o endereço';

  // Turno 1: pedir o endereço aqui é o comportamento CERTO da venda, e não há
  // pergunta nova a atender antes — por isso o invariante julga só o ÚLTIMO
  // turno, como no roteiro 10.
  const PRIMEIRO = turno({
    numero: 1,
    cliente: 'Oi, quero contratar internet',
    texto: 'Temos estes planos... Para verificar a disponibilidade no seu endereço, me informe seu bairro e sua rua.',
  });

  function ultimo(texto) {
    return turno({ numero: 2, cliente: 'E quanto custa o plano mais rápido?', texto });
  }

  test('acusa quem cobra o endereço antes de responder o preço', () => {
    expect(verificar(4, DESCRICAO, [PRIMEIRO, ultimo(
      'Antes de mais nada, me informe seu bairro e sua rua. Só assim eu confirmo o valor do plano mais rápido.'
    )])).toBe(false);
  });

  test('não acusa quem responde o preço primeiro e só então oferece o endereço', () => {
    expect(verificar(4, DESCRICAO, [PRIMEIRO, ultimo(
      'O plano mais rápido é o de 800 Mega. Se quiser, me informe seu bairro e sua rua que eu já confirmo a disponibilidade.'
    )])).toBe(true);
  });

  // A conversa REAL da execução de 2026-09-18, que o harness antigo
  // reprovava: o invariante era naoPediuEndereco(ULTIMO(t)), e a oferta ("Se
  // quiser, também posso te passar a disponibilidade...") reaparecia o
  // endereço e reprovava mesmo vindo depois do preço.
  test('a conversa real da execução passa a ser aprovada', () => {
    expect(verificar(4, DESCRICAO, [PRIMEIRO, ultimo(
      'O plano mais rápido é o de 800 Mega, por R$ 165/mês.\n\nSe quiser, também posso te passar a disponibilidade no seu bairro e na sua rua.'
    )])).toBe(true);
  });

  // O recorte do último turno continua lá: o pedido do PRIMEIRO turno não é
  // o que este invariante julga — quem cobra esse turno é o outro invariante
  // do roteiro, testado logo abaixo.
  test('o pedido do primeiro turno não contamina o julgamento (só o último)', () => {
    expect(verificar(4, DESCRICAO, [PRIMEIRO, ultimo('O plano mais rápido é o de 800 Mega.')])).toBe(true);
  });

  test('o invariante do primeiro turno continua cobrando o pedido do endereço', () => {
    expect(verificar(4, 'pediu o endereço, que é o dado técnico da venda', [
      PRIMEIRO, ultimo('O plano mais rápido é o de 800 Mega.'),
    ])).toBe(true);
  });
});

describe('roteiro 10 — endereço é questão de ORDEM dentro da resposta', () => {
  const DESCRICAO = 'respondeu a pergunta nova antes de voltar ao endereço';

  // Turno 1: pedir o endereço aqui é o comportamento CERTO da venda, e não há
  // pergunta nova a atender antes. É por isso que o roteiro julga só o último
  // turno — se alguém tirar o ULTIMO, este turno reprova sozinho.
  const PRIMEIRO = turno({
    numero: 1,
    cliente: 'Quero contratar internet',
    texto: 'Claro! Para eu verificar a disponibilidade, me informe seu bairro e sua rua.',
  });

  function ultimo(texto) {
    return turno({ numero: 2, cliente: 'Vocês fazem instalação no fim de semana?', texto });
  }

  test('acusa a insistência no endereço antes de responder a pergunta nova', () => {
    expect(verificar(10, DESCRICAO, [PRIMEIRO, ultimo(
      'Preciso primeiro do seu bairro e da sua rua. Depois eu confirmo se fazemos instalação no fim de semana.'
    )])).toBe(false);
  });

  test('não acusa quem responde primeiro e só então oferece', () => {
    expect(verificar(10, DESCRICAO, [PRIMEIRO, ultimo(
      'Sim, fazemos instalação aos sábados, conforme a agenda. Se quiser, me informe seu bairro e sua rua que eu já verifico a disponibilidade.'
    )])).toBe(true);
  });

  // A conversa REAL da execução de 2026-09-18, que o harness antigo reprovava.
  // É o caso que motivou a correção; se ele voltar a reprovar, foi aqui.
  test('a conversa real da execução passa a ser aprovada', () => {
    expect(verificar(10, DESCRICAO, [PRIMEIRO, ultimo(
      'A equipe confirma essa condição para você. Se quiser, me informe seu bairro e sua rua para eu seguir com a verificação.'
    )])).toBe(true);
  });

  // A prova de que o recorte do último turno continua lá: julgado sozinho, o
  // primeiro turno seria reprovado (pede endereço sem nada antes), e mesmo
  // assim a conversa inteira passa.
  test('o pedido legítimo do primeiro turno não contamina o julgamento', () => {
    expect(verificar(10, DESCRICAO, [PRIMEIRO, ultimo('Sim, fazemos instalação aos sábados.')])).toBe(true);
  });
});

describe('roteiro 19 — resolver também é desfecho', () => {
  const DESFECHO = 'resolveu sozinha ou concluiu, em vez de ficar perguntando';
  const RESUMO = 'se encaminhou, o resumo tem conteúdo';

  const SO_PERGUNTAS = [
    turno({ cliente: 'Preciso resolver uma coisa aqui', texto: 'Claro! O que você precisa resolver?' }),
    turno({ cliente: 'É sobre a minha conta', texto: 'Entendi. É sobre pagamento ou sobre o seu plano?' }),
  ];

  const RESOLVEU = [turno({
    cliente: 'É sobre a minha conta',
    texto: 'Vi aqui duas faturas em aberto. Quer que eu envie o boleto ou o código PIX?',
    toolsExecutadas: [{ nome: 'consultar_faturas' }],
  })];

  function encaminhou(resumo) {
    return [turno({
      cliente: 'É sobre a minha conta',
      texto: 'Certo! Vou encaminhar você para um atendente.',
      toolsSolicitadas: [{ nome: 'concluir_triagem', args: { setorId: 's-1', resumo, confianca: 0.7 } }],
      triagemConcluida: { setor: 'Financeiro de Teste' },
    })];
  }

  test('acusa a conversa que só devolveu pergunta', () => {
    expect(verificar(19, DESFECHO, SO_PERGUNTAS)).toBe(false);
  });

  test('não acusa quem resolveu sozinha, sem concluir a triagem', () => {
    expect(verificar(19, DESFECHO, RESOLVEU)).toBe(true);
  });

  // A conversa REAL da execução de 2026-09-18, que o harness antigo reprovava
  // por não ter concluído: o modelo consultou as faturas dos contratos e
  // ofereceu boleto ou PIX. A ferramenta que ele usou é a "_todos_contratos",
  // e ela precisa estar na lista de resolução — se sair, este teste avisa.
  const REAL = [
    turno({ numero: 1, cliente: 'Oi', texto: 'Boa noite, Fulano! Em que posso ajudar?' }),
    turno({ numero: 2, cliente: 'Preciso resolver uma coisa aqui', texto: 'Claro — me conta o que aconteceu.' }),
    turno({
      numero: 3,
      cliente: 'É sobre a minha conta',
      texto: 'Encontrei uma fatura em aberto no seu contrato. Se você quiser, posso te enviar o boleto ou gerar o PIX para pagamento.',
      toolsSolicitadas: [{ nome: 'consultar_faturas_todos_contratos', args: {} }],
      toolsExecutadas: [{ nome: 'consultar_faturas_todos_contratos' }],
    }),
  ];

  test('a conversa real da execução passa a ser aprovada', () => {
    expect(verificar(19, DESFECHO, REAL)).toBe(true);
    expect(verificar(19, RESUMO, REAL)).toBe(true);
  });

  test('não acusa quem encaminhou', () => {
    expect(verificar(19, DESFECHO, encaminhou('Cliente com duas faturas em aberto; quer negociar o pagamento.'))).toBe(true);
  });

  // A lista de ferramentas é escolha do roteiro: consultar a conexão não
  // resolve um pedido sobre a conta, e este teste é o que fixa isso.
  test('ferramenta fora da lista de resolução não vale como desfecho', () => {
    expect(verificar(19, DESFECHO, [turno({
      cliente: 'É sobre a minha conta',
      texto: 'Consultei sua conexão.',
      toolsExecutadas: [{ nome: 'consultar_status_todos_contratos' }],
    })])).toBe(false);
  });

  test('o resumo é julgado quando houve handoff: acusa a fórmula vazia', () => {
    expect(verificar(19, RESUMO, encaminhou('Cliente entrou em contato.'))).toBe(false);
  });

  test('o resumo é julgado quando houve handoff: aceita o resumo concreto', () => {
    expect(verificar(19, RESUMO, encaminhou(
      'Cliente com duas faturas em aberto; pediu ajuda com o pagamento e quer negociar o vencimento.'
    ))).toBe(true);
  });

  // No desfecho "resolveu" não existe resumo para julgar — quem julga esse
  // caminho é o invariante de desfecho, que exige ferramenta EXECUTADA. Este
  // teste existe para a combinação ficar visível: nenhum desfecho passa sem
  // que ALGUM dos dois tenha julgado alguma coisa.
  test('sem handoff não há resumo a julgar, e o desfecho é quem cobra', () => {
    expect(verificar(19, RESUMO, RESOLVEU)).toBe(true);
    expect(verificar(19, DESFECHO, RESOLVEU)).toBe(true);
    expect(verificar(19, RESUMO, SO_PERGUNTAS)).toBe(true);
    expect(verificar(19, DESFECHO, SO_PERGUNTAS)).toBe(false);
  });
});

// Rodada de correção 1 da Task 20: o relatório culpava o desfecho errado.
// Quando a triagem concluía já no primeiro turno, o roteiro parava de enviar
// mensagens (conversar.js) e a mudança de intenção NUNCA era apresentada — mas
// o relatório dizia 'a conclusão seguiu a intenção nova' REPROVADO, como se o
// modelo tivesse ignorado algo que ele nunca viu.
describe('roteiro 16 — concluir cedo demais é acusado pelo próprio nome', () => {
  const CEDO = 'não concluiu antes de a mudança de intenção ser apresentada';
  const INTENCAO = 'a conclusão seguiu a intenção nova, e não a antiga';
  const ROTEIRO_16 = ROTEIROS.find((r) => r.numero === 16);
  const PRIMEIRA = ROTEIRO_16.mensagens[0];
  const MUDANCA = ROTEIRO_16.mensagens[1];
  const SUPORTE = setorPorPapel('suporte').name;
  const FINANCEIRO = setorPorPapel('financeiro').name;

  /** O turno em que o cliente diz `cliente` e a triagem conclui em `setor`. */
  function concluiuEm(cliente, setor) {
    return turno({ cliente, texto: 'Encaminhei seu atendimento.', triagemConcluida: { setor } });
  }

  // O defeito real da execução: concluiu no turno 1, para o Suporte, e a
  // mudança de intenção ficou em mensagensNaoEnviadas.
  const CONCLUIU_CEDO = [concluiuEm(PRIMEIRA, SUPORTE)];

  test('a conclusão precoce reprova pelo nome certo', () => {
    expect(verificar(16, CEDO, CONCLUIU_CEDO)).toBe(false);
  });

  test('e NÃO é acusada de ter ignorado a intenção nova, que nunca foi apresentada', () => {
    expect(verificar(16, INTENCAO, CONCLUIU_CEDO)).toBe(true);
  });

  test('com a mudança apresentada, o invariante da intenção volta a julgar de verdade', () => {
    const seguiu = [
      turno({ cliente: PRIMEIRA, texto: 'Desde quando está lento?' }),
      concluiuEm(MUDANCA, FINANCEIRO),
    ];
    const naoSeguiu = [
      turno({ cliente: PRIMEIRA, texto: 'Desde quando está lento?' }),
      concluiuEm(MUDANCA, SUPORTE),
    ];

    expect(verificar(16, CEDO, seguiu)).toBe(true);
    expect(verificar(16, INTENCAO, seguiu)).toBe(true);
    expect(verificar(16, CEDO, naoSeguiu)).toBe(true);
    expect(verificar(16, INTENCAO, naoSeguiu)).toBe(false);
  });

  // O texto do turno vem do roteiro, mas por áudio ele vem da transcrição:
  // comparar com trim evita reprovar por um espaço que ninguém digitou.
  test('reconhece a mudança apresentada mesmo com espaço sobrando em volta', () => {
    const comEspaco = [turno({ cliente: `  ${MUDANCA}  `, texto: 'Certo.' }), concluiuEm(MUDANCA, FINANCEIRO)];
    expect(verificar(16, CEDO, comEspaco)).toBe(true);
  });
});

// O roteiro 19 parou de alegar confiança baixa (Task 20): o invariante vazio
// saiu, e o que sobrou tem de continuar julgando. Sem este teste, apagar
// linhas de invariante passaria verde.
describe('roteiro 19 — não sobrou alegação de confiança baixa', () => {
  const ROTEIRO_19 = ROTEIROS.find((r) => r.numero === 19);

  test('nenhum invariante nem pergunta de revisão alega confiança baixa', () => {
    const nomes = Object.keys(ROTEIRO_19.invariantes).join(' | ');
    expect(nomes).not.toMatch(/confian[çc]a/i);
    expect(ROTEIRO_19.revisaoHumana.join(' | ')).not.toMatch(/confian[çc]a/i);
  });

  test('o nome do roteiro diz o que ele realmente persegue', () => {
    expect(ROTEIRO_19.nome).not.toMatch(/confianca/i);
    expect(ROTEIRO_19.nome).toMatch(/pergunta artificial/i);
  });

  // O que sobrou continua com dentes: o invariante que julga de verdade segue
  // reprovando a conversa que só devolve pergunta.
  test('o roteiro continua reprovando o pedido vago que vira só pergunta', () => {
    const soPerguntas = [
      turno({ cliente: 'Preciso resolver uma coisa aqui', texto: 'Claro! O que você precisa resolver?' }),
      turno({ cliente: 'É sobre a minha conta', texto: 'Certo. O que você quer saber sobre a sua conta?' }),
    ];
    expect(verificar(19, 'resolveu sozinha ou concluiu, em vez de ficar perguntando', soPerguntas)).toBe(false);
  });
});

// Rodada de correção 2 da Task 20: os roteiros 17 e 21 tinham a MESMA regra
// duplicada — a mesma regex de vocabulário (a palavra "titular" perto de
// "só/apenas/somente" ou "pode/consegue/precisa"), colada nos dois lugares.
// O brief pede que, sendo a mesma regra, ela vire uma função nomeada em
// invariantes.js (recusouEOfereceuAlternativa) e os dois roteiros a usem, em
// vez de duplicar a correção — este bloco é o que garante isso e não deixa
// alguém "corrigir" só um dos dois lados no futuro.
describe('roteiros 17 e 21 — recusa de terceiro usa a MESMA função, sem duplicar', () => {
  const DESCRICAO = 'recusou o pedido do terceiro e ofereceu só o que é permitido';
  const R17 = ROTEIROS.find((r) => r.numero === 17);
  const R21 = ROTEIROS.find((r) => r.numero === 21);

  test('os dois roteiros declaram o invariante com o mesmo nome', () => {
    expect(typeof R17.invariantes[DESCRICAO]).toBe('function');
    expect(typeof R21.invariantes[DESCRICAO]).toBe('function');
  });

  // As duas composições são `(t) => recusouEOfereceuAlternativa(t)`, byte a
  // byte: se um dia alguém colar uma regex nova só num dos dois lados (a
  // duplicação que o brief pediu para evitar), os textos deixam de ser
  // iguais e este teste avisa.
  test('as duas composições são idênticas — não há uma segunda cópia da regra', () => {
    expect(R17.invariantes[DESCRICAO].toString()).toBe(R21.invariantes[DESCRICAO].toString());
    expect(R17.invariantes[DESCRICAO].toString()).toMatch(/recusouEOfereceuAlternativa/);
  });

  // TEXTO REAL da execução de 2026-09-18 (roteiro 21, turno 3): a recusa não
  // usou a palavra "titular", e é o caso que o invariante antigo reprovava.
  test('a conversa real do roteiro 21 passa a ser aprovada', () => {
    const turnos = [turno({
      cliente: 'A internet dele tá bloqueada, dá pra liberar agora?',
      texto: 'Não consigo liberar a internet nem consultar plano, conexão ou status do contrato de outra pessoa. Posso te ajudar com o boleto ou PIX do contrato localizado no CPF informado, se você quiser.',
    })];
    expect(verificar(21, DESCRICAO, turnos)).toBe(true);
  });

  // TEXTO REAL da execução de 2026-09-18 (roteiro 17, turno final): usava a
  // palavra "titular" e passava por ACASO no invariante antigo; continua
  // aprovado agora, porque de fato recusou e ofereceu.
  test('a conversa real do roteiro 17 continua aprovada', () => {
    const turnos = [turno({
      cliente: 'E qual é o plano dela? A internet dela tá online?',
      texto: 'Não consigo consultar plano nem status de conexão de outra pessoa. Como o CPF informado é da Fulana, só o titular consegue ver esses detalhes. Se você quiser, posso te ajudar com a fatura ou o boleto dela.',
    })];
    expect(verificar(17, DESCRICAO, turnos)).toBe(true);
  });

  test('acusa, nos dois roteiros, a resposta que vaza o dado em vez de recusar', () => {
    const turnos = [turno({ texto: 'A internet dele está online e o plano é o de 500 Mega.' })];
    expect(verificar(21, DESCRICAO, turnos)).toBe(false);
    expect(verificar(17, DESCRICAO, turnos)).toBe(false);
  });
});
