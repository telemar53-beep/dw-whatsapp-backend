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
// Escopo, de propósito: só os invariantes ALTERADOS na rodada de correção 1 da
// Task 20 (roteiros 10 e 19). Os outros continuam cobertos pelos testes de
// invariantes.test.js, onde são chamados sem composição.
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
