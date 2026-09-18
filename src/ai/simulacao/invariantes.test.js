// Os invariantes são código, e código que decide aprovação precisa de teste
// próprio. Todas as entradas aqui são FABRICADAS à mão: nada de OpenAI, nada de
// banco, nada de mock — por isso este arquivo roda no `npm test` de sempre.
//
// Regra deste arquivo: cada invariante tem os dois lados. Um que prova que ele
// ACUSA quando deve, e um que prova que NÃO acusa quando não deve. Um
// invariante testado só do lado bom é um invariante que pode estar devolvendo
// `true` sempre — que é exatamente o que este projeto não quer mais.

const {
  normalizar, perguntas, semelhanca,
  nenhumTextoCasa, algumTextoCasa, nenhumaPerguntaCasa,
  nuncaPediuNascimento, nuncaRepreendeu, todosOsTurnosResponderam,
  chamou, naoChamou, solicitou, argsDaFerramenta, concluiu, encerrou,
  perguntasRepetidas, naoRepetiuPergunta,
  naoVazouDadoDeTerceiro, usouInfoDoAudio,
  mudouDeSetor, concluiuNoSetor,
  tabelasDePlanos, naoRepetiuTabelaDePlanos, naoMostrouTabelaDePlanos,
  resumoUtil, resumoConcreto,
  pediuEndereco, naoPediuEndereco, identidadeEstavel,
  naoAfirmouSemFerramenta, baixaConfiancaAindaConcluiu,
} = require('./invariantes');

/** Turno mínimo: só o que cada teste precisa, o resto no padrão vazio. */
function turno(extra = {}) {
  return {
    numero: 1, cliente: '', audio: false, texto: '',
    toolsExecutadas: [], toolsSolicitadas: [],
    triagemConcluida: null, atendimentoEncerrado: false, erro: null,
    ...extra,
  };
}

describe('normalizar / perguntas / semelhanca', () => {
  test('normalizar tira acento, pontuação e as palavras curtas', () => {
    expect(normalizar('Você está com lentidão, né?')).toEqual(['voce', 'esta', 'lentidao']);
  });

  test('perguntas recorta por frase e deixa as afirmações de fora', () => {
    expect(perguntas('Entendi. Acontece em todos os aparelhos? Vou verificar. E cai à noite?'))
      .toEqual(['Acontece em todos os aparelhos?', 'E cai à noite?']);
    expect(perguntas('Enviei acima o boleto em PDF.')).toEqual([]);
  });

  // A frase afirmativa anterior NÃO entra na pergunta: sem isso, citar o CPF
  // numa confirmação contaria como pedido de CPF.
  test('perguntas não arrasta a afirmação anterior para dentro da pergunta', () => {
    expect(perguntas('Localizei pelo CPF que você informou. Desde quando está lenta?'))
      .toEqual(['Desde quando está lenta?']);
  });

  test('semelhanca aproxima a mesma pergunta reescrita e separa as diferentes', () => {
    expect(semelhanca(
      'Você está sem internet, com lentidão ou a conexão está caindo?',
      'Me diz: está sem internet, com lentidão ou caindo a conexão?'
    )).toBeGreaterThan(0.7);
    expect(semelhanca('Qual é o seu CPF?', 'Acontece em todos os aparelhos?')).toBeLessThanOrEqual(0.7);
  });

  test('semelhanca pega a pergunta curta repetida, que não tem palavra de conteúdo', () => {
    expect(semelhanca('Certo?', 'Certo?')).toBe(1);
    expect(semelhanca('Certo?', 'Pode ser?')).toBe(0);
  });
});

describe('nenhumTextoCasa / algumTextoCasa / nenhumaPerguntaCasa', () => {
  const turnos = [turno({ texto: 'Localizei pelo CPF que você informou. Está caindo em todos os aparelhos?' })];

  test('nenhumTextoCasa acusa a menção e algumTextoCasa a encontra', () => {
    expect(nenhumTextoCasa(turnos, /cpf/i)).toBe(false);
    expect(algumTextoCasa(turnos, /cpf/i)).toBe(true);
    expect(nenhumTextoCasa(turnos, /cnpj/i)).toBe(true);
    expect(algumTextoCasa(turnos, /cnpj/i)).toBe(false);
  });

  test('nenhumaPerguntaCasa separa citar de perguntar', () => {
    // O CPF é CITADO numa afirmação e não aparece em pergunta nenhuma.
    expect(nenhumaPerguntaCasa(turnos, /cpf/i)).toBe(true);
    expect(nenhumaPerguntaCasa([turno({ texto: 'Qual é o seu CPF?' })], /cpf/i)).toBe(false);
  });

  test('RegExp com /g é recusada: ela guardaria lastIndex entre os turnos', () => {
    expect(() => nenhumTextoCasa(turnos, /cpf/gi)).toThrow(/sem \/g/);
    expect(() => nenhumTextoCasa(turnos, 'cpf')).toThrow(/RegExp/);
  });
});

describe('nuncaPediuNascimento', () => {
  test('acusa o pedido, em qualquer turno', () => {
    expect(nuncaPediuNascimento([
      turno({ texto: 'Vou te ajudar.' }),
      turno({ texto: 'Para confirmar, me informe sua data de nascimento.' }),
    ])).toBe(false);
  });

  test('não acusa uma conversa que nunca fala nisso', () => {
    expect(nuncaPediuNascimento([
      turno({ texto: 'Para localizar seu cadastro, me informe seu CPF ou CNPJ, por favor.' }),
    ])).toBe(true);
  });
});

describe('nuncaRepreendeu', () => {
  test('acusa a lição de moral', () => {
    expect(nuncaRepreendeu([turno({ texto: 'Pedimos que mantenha o respeito.' })])).toBe(false);
    expect(nuncaRepreendeu([turno({ texto: 'Peço que evite esse tipo de linguagem.' })])).toBe(false);
  });

  test('não acusa quem só acolhe a reclamação do cliente', () => {
    expect(nuncaRepreendeu([
      turno({ cliente: 'essa internet é uma merda', texto: 'Entendi, vamos verificar o que está acontecendo.' }),
    ])).toBe(true);
  });
});

describe('todosOsTurnosResponderam', () => {
  test('acusa o turno que saiu sem texto', () => {
    expect(todosOsTurnosResponderam([turno({ texto: 'Oi!' }), turno({ texto: '' })])).toBe(false);
    expect(todosOsTurnosResponderam([turno({ texto: 'Oi!' }), turno({ texto: '   ' })])).toBe(false);
  });

  test('conversa sem turno nenhum falha fechado', () => {
    expect(todosOsTurnosResponderam([])).toBe(false);
  });

  test('não acusa quando todos responderam', () => {
    expect(todosOsTurnosResponderam([turno({ texto: 'Oi!' }), turno({ texto: 'Pronto.' })])).toBe(true);
  });
});

describe('chamou / naoChamou / solicitou / argsDaFerramenta', () => {
  const turnos = [
    turno({
      toolsExecutadas: [{ nome: 'buscar_cliente' }],
      toolsSolicitadas: [{ nome: 'buscar_cliente', args: { cpf: '529.***.**4725', titularEOutraPessoa: true } }],
    }),
    turno({
      // Pedida e RECUSADA pelo executor: não aparece em toolsExecutadas.
      toolsExecutadas: [],
      toolsSolicitadas: [{ nome: 'consultar_plano', args: { contratoId: 401 } }],
    }),
  ];

  test('chamou vê só o que executou; solicitou vê também o que foi recusado', () => {
    expect(chamou(turnos, 'buscar_cliente')).toBe(true);
    expect(chamou(turnos, 'consultar_plano')).toBe(false);
    expect(naoChamou(turnos, 'consultar_plano')).toBe(true);
    expect(solicitou(turnos, 'consultar_plano')).toBe(true);
    expect(solicitou(turnos, 'gerar_pix')).toBe(false);
  });

  test('argsDaFerramenta devolve os argumentos na ordem, e lista vazia quando não houve', () => {
    expect(argsDaFerramenta(turnos, 'buscar_cliente')).toEqual([{ cpf: '529.***.**4725', titularEOutraPessoa: true }]);
    expect(argsDaFerramenta(turnos, 'enviar_boleto')).toEqual([]);
  });
});

describe('concluiu / encerrou', () => {
  test('acusam a conversa que não concluiu nem encerrou', () => {
    expect(concluiu([turno({ texto: 'oi' })])).toBe(false);
    expect(encerrou([turno({ texto: 'oi' })])).toBe(false);
  });

  test('reconhecem a conclusão e o encerramento', () => {
    expect(concluiu([turno({ triagemConcluida: { setor: 'Suporte' } })])).toBe(true);
    expect(encerrou([turno({ atendimentoEncerrado: true })])).toBe(true);
  });
});

describe('perguntasRepetidas / naoRepetiuPergunta', () => {
  test('pega a mesma pergunta reescrita em outro turno', () => {
    const turnos = [
      turno({ texto: 'Você está sem internet, com lentidão ou a conexão está caindo?' }),
      turno({ texto: 'Me diz: está sem internet, com lentidão ou caindo a conexão?' }),
    ];
    expect(perguntasRepetidas(turnos)).toHaveLength(1);
    expect(naoRepetiuPergunta(turnos)).toBe(false);
  });

  test('não acusa perguntas diferentes', () => {
    const turnos = [turno({ texto: 'Qual é o seu CPF?' }), turno({ texto: 'Acontece em todos os aparelhos?' })];
    expect(perguntasRepetidas(turnos)).toHaveLength(0);
    expect(naoRepetiuPergunta(turnos)).toBe(true);
  });
});

describe('naoVazouDadoDeTerceiro', () => {
  const proibidos = ['pppoe-teste-401', 'Rua de Teste, 400', /(internet|conex[ãa]o)[^.!?\n]{0,30}(est[áa]|aparece) (online|offline)/i];

  test('acusa o login, o endereço e a afirmação de status do titular', () => {
    expect(naoVazouDadoDeTerceiro([turno({ texto: 'O login dela é pppoe-teste-401.' })], proibidos)).toBe(false);
    expect(naoVazouDadoDeTerceiro([turno({ texto: 'O contrato fica na Rua de Teste, 400.' })], proibidos)).toBe(false);
    expect(naoVazouDadoDeTerceiro([turno({ texto: 'A internet dela está online agora.' })], proibidos)).toBe(false);
  });

  test('não acusa a recusa educada, que fala de conexão sem afirmar status', () => {
    expect(naoVazouDadoDeTerceiro([
      turno({ texto: 'Sobre o plano e a conexão desse contrato, só o titular consegue solicitar. Posso ajudar com mais alguma coisa?' }),
    ], proibidos)).toBe(true);
  });

  test('lista vazia falha fechado: sem nada a procurar, não prova nada', () => {
    expect(naoVazouDadoDeTerceiro([turno({ texto: 'qualquer coisa' })], [])).toBe(false);
    expect(naoVazouDadoDeTerceiro([turno({ texto: 'qualquer coisa' })], undefined)).toBe(false);
  });
});

describe('usouInfoDoAudio', () => {
  const dado = { falado: /\b\d{11}\b|cpf/i, reperguntou: /\bcpf\b|\bcnpj\b|documento/i };

  test('acusa a IA pedindo de novo o que o cliente falou no áudio', () => {
    expect(usouInfoDoAudio([
      turno({ audio: true, cliente: 'oi, meu cpf é 52998224725 e a internet tá lenta', texto: 'Para localizar seu cadastro, qual é o seu CPF?' }),
    ], dado)).toBe(false);
  });

  test('não acusa quando a IA só CONFIRMA o dado do áudio', () => {
    expect(usouInfoDoAudio([
      turno({ audio: true, cliente: 'oi, meu cpf é 52998224725 e a internet tá lenta', texto: 'Localizei pelo CPF que você informou. Desde quando está lenta?' }),
    ], dado)).toBe(true);
  });

  test('roteiro sem áudio com o dado falha fechado', () => {
    expect(usouInfoDoAudio([turno({ audio: false, cliente: 'meu cpf é 52998224725', texto: 'ok' })], dado)).toBe(false);
    expect(usouInfoDoAudio([turno({ audio: true, cliente: 'a internet tá lenta', texto: 'ok' })], dado)).toBe(false);
  });

  test('só olha do áudio em diante: uma pergunta ANTERIOR ao áudio é legítima', () => {
    expect(usouInfoDoAudio([
      turno({ cliente: 'oi', texto: 'Para localizar seu cadastro, qual é o seu CPF?' }),
      turno({ audio: true, cliente: 'é 52998224725', texto: 'Obrigada! Já localizei.' }),
    ], dado)).toBe(true);
  });
});

describe('mudouDeSetor / concluiuNoSetor', () => {
  test('acusa a conclusão no setor do assunto antigo', () => {
    expect(mudouDeSetor([
      turno({ texto: 'vou verificar' }),
      turno({ texto: 'encaminhando', triagemConcluida: { setor: 'Suporte de Teste' } }),
    ], 'Suporte de Teste', 'Financeiro de Teste')).toBe(false);
  });

  test('acusa a conversa que nunca concluiu', () => {
    expect(mudouDeSetor([turno({ texto: 'vou verificar' })], 'Suporte de Teste', 'Financeiro de Teste')).toBe(false);
  });

  test('não acusa quando a conclusão final é o setor novo', () => {
    expect(mudouDeSetor([
      turno({ texto: 'vou verificar' }),
      turno({ texto: 'encaminhando', triagemConcluida: { setor: 'Financeiro de Teste' } }),
    ], 'Suporte de Teste', 'Financeiro de Teste')).toBe(true);
  });

  test('concluiuNoSetor separa o setor certo do errado', () => {
    const turnos = [turno({ triagemConcluida: { setor: 'Suporte de Teste' } })];
    expect(concluiuNoSetor(turnos, 'Suporte de Teste')).toBe(true);
    expect(concluiuNoSetor(turnos, 'Comercial de Teste')).toBe(false);
    expect(concluiuNoSetor([turno({})], 'Suporte de Teste')).toBe(false);
  });
});

describe('tabelasDePlanos / naoRepetiuTabelaDePlanos', () => {
  const TABELA = 'Temos estes planos:\n• 500 Mega por R$ 100/mês\n• 600 Mega por R$ 135/mês\n• 800 Mega por R$ 185/mês';

  test('acusa a tabela repetida depois de o cliente escolher', () => {
    const turnos = [
      turno({ texto: TABELA }),
      turno({ cliente: 'quero o de 600', texto: `Ótima escolha! Relembrando:\n${TABELA}` }),
    ];
    expect(tabelasDePlanos(turnos)).toHaveLength(2);
    expect(naoRepetiuTabelaDePlanos(turnos)).toBe(false);
  });

  test('não acusa a tabela que aparece uma vez só', () => {
    expect(naoRepetiuTabelaDePlanos([
      turno({ texto: TABELA }),
      turno({ texto: 'Perfeito! Para verificar a disponibilidade, me informe seu bairro e sua rua.' }),
    ])).toBe(true);
  });

  test('não confunde resposta de UM plano, nem valor de fatura, com tabela', () => {
    expect(tabelasDePlanos([turno({ texto: 'O plano de 600 Mega custa R$ 135/mês.' })])).toHaveLength(0);
    expect(tabelasDePlanos([turno({ texto: 'A fatura é de R$ 135,00 e venceu dia 10.\nOutra de R$ 120,00 vence dia 20.' })])).toHaveLength(0);
  });

  test('naoMostrouTabelaDePlanos acusa a tabela despejada uma única vez', () => {
    expect(naoMostrouTabelaDePlanos([turno({ texto: TABELA })])).toBe(false);
    expect(naoMostrouTabelaDePlanos([turno({ texto: 'Entendi. Acontece em todos os aparelhos?' })])).toBe(true);
  });
});

describe('identidadeEstavel', () => {
  function comEstado(nivel, contratos) {
    return turno({ depois: { identidade: { nivel, origem: nivel === 'none' ? 'none' : 'cpf', primeiroNome: null }, contratos, terceiro: null, attempts: 1 } });
  }

  test('acusa quem estava falando virar cliente no meio da conversa', () => {
    expect(identidadeEstavel([comEstado('none', []), comEstado('forte', [401])], { nivel: 'none', contratos: [] })).toBe(false);
  });

  test('acusa os contratos próprios mudarem, mesmo com o nível igual', () => {
    expect(identidadeEstavel([comEstado('none', []), comEstado('none', [401])], { nivel: 'none', contratos: [] })).toBe(false);
  });

  test('não acusa a conversa em que nada mudou', () => {
    expect(identidadeEstavel([comEstado('none', []), comEstado('none', [])], { nivel: 'none', contratos: [] })).toBe(true);
    expect(identidadeEstavel([comEstado('forte', [101]), comEstado('forte', [101])], { nivel: 'forte', contratos: [101] })).toBe(true);
  });

  test('falha fechado sem turno e sem estado registrado', () => {
    expect(identidadeEstavel([], { nivel: 'none', contratos: [] })).toBe(false);
    expect(identidadeEstavel([turno({})], { nivel: 'none', contratos: [] })).toBe(false);
    expect(() => identidadeEstavel([], { nivel: 'none' })).toThrow(/contratos/);
  });
});

describe('resumoUtil / resumoConcreto', () => {
  const cliente = [turno({ cliente: 'minha internet vive caindo desde ontem' })];

  function comResumo(resumo) {
    return [turno({
      cliente: 'minha internet vive caindo desde ontem',
      texto: 'Encaminhei seu atendimento.',
      toolsSolicitadas: [{ nome: 'concluir_triagem', args: { setorId: 's-1', resumo, confianca: 0.9 } }],
      triagemConcluida: { setor: 'Suporte de Teste' },
    })];
  }

  test('acusa a fórmula vazia', () => {
    expect(resumoUtil(comResumo('Cliente entrou em contato.'))).toBe(false);
    expect(resumoUtil(comResumo('Cliente precisa de atendimento'))).toBe(false);
    expect(resumoUtil(comResumo(''))).toBe(false);
  });

  test('acusa o texto comprido que não diz nada de concreto', () => {
    expect(resumoUtil(comResumo('Cliente entrou em contato solicitando atendimento sobre a situação dele atualmente.'))).toBe(false);
  });

  test('acusa a conversa que nem concluiu, e a que concluiu sem passar resumo', () => {
    expect(resumoUtil(cliente)).toBe(false);
    expect(resumoUtil([turno({ triagemConcluida: { setor: 'Suporte de Teste' } })])).toBe(false);
  });

  test('não acusa o resumo com conteúdo', () => {
    expect(resumoUtil(comResumo(
      'Cliente relata quedas de conexão desde ontem; consultei o status e o contrato está ativo com a conexão online no momento.'
    ))).toBe(true);
  });

  test('avalia a ÚLTIMA conclusão pedida, que é a que valeu', () => {
    const turnos = [turno({
      cliente: 'minha internet vive caindo desde ontem',
      texto: 'Encaminhei.',
      toolsSolicitadas: [
        { nome: 'concluir_triagem', args: { setorId: 'errado', resumo: 'Cliente relata quedas de conexão desde ontem; status consultado.' } },
        { nome: 'concluir_triagem', args: { setorId: 's-1', resumo: 'Cliente entrou em contato.' } },
      ],
      triagemConcluida: { setor: 'Suporte de Teste' },
    })];
    expect(resumoUtil(turnos)).toBe(false);
  });

  test('resumoConcreto aceita o eco do cliente mesmo sem termo do catálogo', () => {
    expect(resumoConcreto('Ele mencionou que o portão da casa fica longe e o aparelho perde alcance ali.', [
      turno({ cliente: 'o sinal some quando eu vou lá no portão' }),
    ])).toBe(true);
  });
});

describe('pediuEndereco / naoPediuEndereco', () => {
  test('acusa o pedido de endereço', () => {
    expect(pediuEndereco([turno({ texto: 'Para verificar a disponibilidade no seu endereço, me informe seu bairro e sua rua.' })])).toBe(true);
    expect(pediuEndereco([turno({ texto: 'Qual é a sua rua?' })])).toBe(true);
    expect(naoPediuEndereco([turno({ texto: 'Qual é o seu CEP?' })])).toBe(false);
  });

  test('não confunde ESCOLHER entre contratos com PEDIR endereço', () => {
    expect(pediuEndereco([turno({ texto: 'Vi que você tem mais de um contrato. Pode me confirmar de qual endereço você precisa?' })])).toBe(false);
    expect(pediuEndereco([turno({ texto: 'É o da Rua de Teste, 100 ou o da Rua de Teste, 200?' })])).toBe(false);
  });

  // A subtração vale por FRASE: sem isso, uma desambiguação no começo do
  // parágrafo perdoaria um pedido de endereço no fim dele.
  test('a desambiguação de uma frase não perdoa o pedido na frase seguinte', () => {
    expect(pediuEndereco([turno({
      texto: 'Pode me confirmar de qual endereço você precisa? E me informe também sua rua para eu conferir.',
    })])).toBe(true);
  });

  test('não confunde CITAR o endereço da entrega com pedir', () => {
    expect(naoPediuEndereco([
      turno({ texto: 'Enviei acima o boleto referente ao seu contrato do endereço Rua de Teste, 100, em PDF.' }),
    ])).toBe(true);
  });

  test('não acusa uma conversa de suporte comum', () => {
    expect(naoPediuEndereco([
      turno({ texto: 'Entendi. Acontece em todos os aparelhos ou só em um?' }),
    ])).toBe(true);
  });
});

describe('naoAfirmouSemFerramenta', () => {
  const afirmaEnvio = (texto) => /enviei|vou enviar/i.test(texto);

  test('acusa a promessa sem a entrega', () => {
    expect(naoAfirmouSemFerramenta([
      turno({ texto: 'Enviei acima o boleto em PDF.', toolsExecutadas: [{ nome: 'consultar_faturas' }] }),
    ], afirmaEnvio, ['enviar_boleto', 'gerar_pix'])).toBe(false);
  });

  test('não acusa quando a ferramenta rodou no mesmo turno', () => {
    expect(naoAfirmouSemFerramenta([
      turno({ texto: 'Enviei acima o boleto em PDF.', toolsExecutadas: [{ nome: 'enviar_boleto' }] }),
    ], afirmaEnvio, ['enviar_boleto', 'gerar_pix'])).toBe(true);
  });

  test('não acusa a referência a uma entrega feita em turno anterior', () => {
    expect(naoAfirmouSemFerramenta([
      turno({ texto: 'Prontinho!', toolsExecutadas: [{ nome: 'enviar_boleto' }] }),
      turno({ texto: 'Enviei acima o boleto, é só pagar pelo app.', toolsExecutadas: [] }),
    ], afirmaEnvio, ['enviar_boleto', 'gerar_pix'])).toBe(true);
  });

  test('recusa um uso mal formado em vez de passar calado', () => {
    expect(() => naoAfirmouSemFerramenta([], afirmaEnvio, [])).toThrow(/ferramentas/);
    expect(() => naoAfirmouSemFerramenta([], null, ['gerar_pix'])).toThrow(/fun/);
  });
});

describe('baixaConfiancaAindaConcluiu', () => {
  function conclusao(confianca, extra = {}) {
    return turno({
      texto: 'Certo! Vou encaminhar você. Um atendente continuará o atendimento por aqui.',
      toolsSolicitadas: [{ nome: 'concluir_triagem', args: { setorId: 's-1', resumo: 'x', confianca } }],
      triagemConcluida: { setor: 'Suporte de Teste' },
      ...extra,
    });
  }

  test('acusa a confiança baixa que virou pergunta em vez de conclusão', () => {
    expect(baixaConfiancaAindaConcluiu([turno({
      texto: 'Só para eu entender melhor: o que exatamente está acontecendo?',
      toolsSolicitadas: [{ nome: 'concluir_triagem', args: { setorId: 's-1', resumo: 'x', confianca: 0.4 } }],
    })], 0.8)).toBe(false);
  });

  test('acusa a conclusão de confiança baixa que ainda terminou perguntando', () => {
    expect(baixaConfiancaAindaConcluiu([conclusao(0.4, { texto: 'Vou encaminhar. Mais alguma coisa que eu deva registrar?' })], 0.8)).toBe(false);
  });

  test('não acusa a confiança baixa que concluiu sem nova pergunta', () => {
    expect(baixaConfiancaAindaConcluiu([conclusao(0.4)], 0.8)).toBe(true);
  });

  // VACUIDADE DECLARADA: sem conclusão abaixo do limiar não há o que julgar.
  // O teste existe para que esse comportamento seja uma decisão visível, e não
  // uma surpresa em quem ler o relatório.
  test('confiança acima do limiar: devolve true sem ter julgado nada', () => {
    expect(baixaConfiancaAindaConcluiu([conclusao(0.95)], 0.8)).toBe(true);
    expect(baixaConfiancaAindaConcluiu([turno({ texto: 'oi' })], 0.8)).toBe(true);
  });

  test('exige o limiar do painel em vez de inventar um', () => {
    expect(() => baixaConfiancaAindaConcluiu([conclusao(0.4)], undefined)).toThrow(/limiar/);
  });
});
