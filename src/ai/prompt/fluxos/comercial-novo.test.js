const comercialNovo = require('./comercial-novo');
const { estadoBase } = require('../estado-de-teste');

describe('módulo comercial-novo', () => {
  describe('entra()', () => {
    test('entra quando o cliente ainda não foi identificado', () => {
      const estado = estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
      });
      expect(comercialNovo.entra(estado)).toBe(true);
    });

    test('NÃO entra com o cliente já identificado', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
        contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }],
      });
      expect(comercialNovo.entra(estado)).toBe(false);
    });

    test('NÃO entra com SGP indisponível (identidade continua forte pela memória)', () => {
      const estado = estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      });
      expect(comercialNovo.entra(estado)).toBe(false);
    });
  });

  describe('conteúdo', () => {
    const texto = (extra) => comercialNovo.linhas(estadoBase(extra)).join('\n');

    test('cobre cobertura, planos e contratação', () => {
      expect(texto()).toMatch(/VENDA \(cobertura, planos, contratar, mudar de plano\)/);
    });

    test('nunca pede CPF ou CNPJ de cliente novo', () => {
      expect(texto()).toMatch(/Nunca peça CPF ou CNPJ de cliente novo/);
    });

    test('cobertura: cidade na lista atende todos os bairros; fora da lista encaminha sem inventar', () => {
      const t = texto();
      expect(t).toMatch(/se a cidade estiver nas instruções, atendemos em TODOS os bairros e ruas dela/i);
      expect(t).toMatch(/Se a cidade NÃO estiver na lista de cobertura, diga que a equipe confirma a cobertura e conclua para o setor da lista acima que cuidar de vendas, sem inventar\./);
    });

    test('pergunta de cobertura emenda a abertura de cliente novo na mesma mensagem', () => {
      expect(texto()).toMatch(/a pergunta de cobertura é o começo da venda, não o fim/);
    });

    test('cliente que já diz ser cliente é identificado primeiro, sem listar todas as cidades', () => {
      const t = texto();
      expect(t).toMatch(/Se ele disser que JÁ é cliente e quer outro ponto ou mudar de plano, identifique-o primeiro \(peça CPF ou CNPJ\)/);
      expect(t).toMatch(/Não liste todas as cidades atendidas/);
    });

    test('formato de plano sem bloco pronto usa marcador de velocidade e valor, nunca número real', () => {
      const t = texto();
      expect(t).toContain('• [velocidade] por R$ [valor]/mês');
      expect(t).not.toMatch(/\d+\s*mega/i);
      expect(t).not.toMatch(/R\$\s*\d/);
    });

    test('abertura de cliente novo diz "Temos estes planos:", sem afirmar 100% fibra óptica nem instalação grátis', () => {
      const t = texto();
      expect(t).toContain('Temos estes planos:');
      expect(t).not.toMatch(/100% fibra óptica/i);
      expect(t).not.toMatch(/[Ii]nstalação grátis/);
    });

    test('a saudação da abertura não crava horário fixo: usa o marcador de saudação da hora', () => {
      const t = texto();
      expect(t).toMatch(/\(saudação da hora\)/);
      expect(t).not.toMatch(/Boa noite! 😊 Temos/);
    });

    test('endereço é uma pergunta só, com exemplo usando marcador de bairro\\/cidade (não nome real)', () => {
      const t = texto();
      expect(t).toMatch(/Endereço é UMA pergunta só \(bairro e rua juntos\)/);
      expect(t).toContain('[bairro], [cidade]');
      expect(t).not.toMatch(/Godofredo Viana/);
    });

    test('recomendação de plano responde antes de encaminhar, sem citar preço real', () => {
      const t = texto();
      expect(t).toMatch(/RECOMENDAÇÃO/);
      expect(t).toMatch(/Nunca encaminhe deixando uma pergunta dele sem resposta/);
    });

    test('documentação de cadastro: usa a lista das instruções, ou avisa e encaminha sem deixar sem resposta', () => {
      const t = texto();
      expect(t).toMatch(/O QUE PRECISA PARA FAZER O CADASTRO/);
      expect(t).toMatch(/mas NÃO encaminhe sem responder alguma coisa/);
    });

    // A cláusula do endereço foi apertada duas vezes, pelo mesmo motivo:
    // disparava sem intenção do cliente. Primeiro ganhou "E não houver mais nada
    // de venda para tratar" (que corrigiu o meio da venda e quebrou o fim:
    // "Ok muito obrigado" satisfazia a condição), depois passou a exigir que ele
    // DIGA que quer seguir. Ver os dois describes de regressão no fim do arquivo.
    test('só encaminha nas condições previstas (plano escolhido, endereço dado E intenção dita, pediu atendente, ou cidade fora da lista)', () => {
      const t = texto();
      expect(t).toMatch(/SOMENTE quando: ele escolher um plano ou pedir para contratar; ou já tiver dado o endereço E disser que quer seguir com a contratação ou a instalação; ou pedir para falar com um atendente; ou a cidade não estiver na lista\./);
    });

    test('resumo do encaminhamento inclui plano, cidade e bairro/rua', () => {
      expect(texto()).toMatch(/Ao encaminhar, o resumo inclui: plano de interesse, cidade, bairro\/rua se tiver, e o que ele contou\./);
    });

    // Rodada de correção 1 da Task 17 (coordenador): a frase-modelo de
    // encaminhamento ao setor de vendas, que tinha ficado sem dono (a
    // metade diurna) e depois foi migrada errado (a metade noturna foi
    // parar em noturno.js, arriscando frases concorrentes). Agora as duas
    // metades vivem juntas aqui, ramificando em triagem.noturno.ativo.
    describe('frase-modelo de encaminhamento ao setor de vendas (dia x noite)', () => {
      test('de dia, o modelo diz que um atendente continua por aqui, sem menção a horário', () => {
        const t = texto({ triagem: { noturno: { ativo: false }, forcarConclusao: false } });
        expect(t).toMatch(/Vou encaminhar você\. Um atendente continuará o atendimento por aqui\./);
        expect(t).not.toMatch(/fora do horário de atendimento/);
      });

      test('à noite, o modelo avisa que está fora do horário e a conversa fica registrada', () => {
        const t = texto({ triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false } });
        expect(t).toMatch(/No momento estamos fora do horário de atendimento, mas sua conversa ficará registrada e nossa equipe continuará por aqui assim que o expediente iniciar\./);
        expect(t).not.toMatch(/Um atendente continuará o atendimento por aqui\./);
      });

      // Rodada de correção 3 (Task 17): dois defeitos na versão anterior
      // deste teste. (a) se a frase-âncora fosse reescrita, indexOf devolvia
      // -1 e slice(-1) devolvia o ÚLTIMO CARACTERE da string — a asserção
      // passava em silêncio, mesma família do
      // `expect(completeTriage).not.toHaveBeenCalled()` que este projeto já
      // teve. Corrigido: a existência da âncora agora é asseverada primeiro.
      // (b) slice(0, 300) cortava a variante noturna (417 caracteres) e
      // nunca chegava a checar o final dela. Corrigido: checa o trecho
      // inteiro a partir da âncora, sem cortar.
      test('nem de dia nem à noite a frase nomeia o setor (nem fora, nem dentro do script ao cliente)', () => {
        for (const noturno of [true, false]) {
          const t = texto({ triagem: { noturno: { ativo: noturno, retornoAs: '08:00' }, forcarConclusao: false } });
          const i = t.indexOf('Ao encaminhar para o setor da lista acima que cuidar de vendas (na MESMA');
          expect(i).toBeGreaterThanOrEqual(0);
          const trecho = t.slice(i);
          expect(trecho).not.toMatch(/Comercial/);
        }
      });

      test('não duplica a instrução de resumo — só uma ocorrência, independente do horário', () => {
        for (const noturno of [true, false]) {
          const t = texto({ triagem: { noturno: { ativo: noturno, retornoAs: '08:00' }, forcarConclusao: false } });
          expect(t.match(/Ao encaminhar, o resumo inclui/g) || []).toHaveLength(1);
        }
      });
    });

    // =================================================================
    // Task 18 — asserts migrados de ai-orchestrator.test.js
    // =================================================================

    // Antes: ai-orchestrator.test.js:1297. Print 2026-09-17 (18:25): cliente
    // COM contrato perguntou se o sinal tinha normalizado e recebeu a tabela
    // de planos inteira. A tabela tem dono: cliente NÃO identificado.
    test('a tabela de planos tem dono: só cliente não identificado que pergunta de contratar, preço ou cobertura', () => {
      expect(texto()).toMatch(/A tabela de planos é SÓ para cliente NÃO identificado que pergunta sobre contratar, preço ou cobertura\./);
    });

    // Antes: ai-orchestrator.test.js:1435 e :1396. A fonte única de verdade
    // dos planos são as instruções da operação — copiadas como estão, com as
    // mesmas linhas, ícones e preços. Vale para o bloco de planos e para a
    // lista de documentos do cadastro.
    test('planos e documentação são copiados das instruções exatamente como estão lá', () => {
      const t = texto();
      expect(t).toMatch(/copie o bloco de planos EXATAMENTE como está escrito nas instruções \(mesmas linhas, mesmos ícones, mesmos preços\)/);
      expect(t).toMatch(/responda com a lista exatamente como está lá e pergunte se ele quer seguir com a contratação/);
    });

    // Antes: ai-orchestrator.test.js:1416 e :1418. A abertura tem duas partes
    // que o dono ditou em 2026-09-15: o acolhimento opcional e o pedido de
    // endereço que fecha a mensagem.
    test('a abertura acolhe e fecha pedindo bairro e rua numa pergunta só', () => {
      const t = texto();
      expect(t).toMatch(/"Que bom ter você por aqui 😊" pode entrar depois da saudação\./);
      expect(t).toMatch(/Para verificar a disponibilidade no seu endereço, me informe seu bairro e sua rua\./);
    });

    // Antes: ai-orchestrator.test.js:1441-1442. Teste real 2026-09-15 (print
    // do dono): a IA pediu bairro/rua três vezes. Duas regras saem daí — nunca
    // pedir três vezes, e não precisar do endereço completo para encaminhar.
    test('endereço: nunca é pedido uma terceira vez, e não precisa estar completo para encaminhar', () => {
      const t = texto();
      expect(t).toMatch(/Nunca peça a mesma coisa uma terceira vez\./);
      expect(t).toMatch(/Se ele mudar de assunto ou perguntar algo, responda e siga sem voltar a cobrar o endereço\./);
      expect(t).toMatch(/Não é preciso ter o endereço completo para encaminhar\./);
    });

    // Antes: ai-orchestrator.test.js:1452-1453. Mesmo print: perguntado "qual
    // é o melhor?", a IA encaminhou sem responder. As duas saídas possíveis
    // estão escritas — com critério nas instruções, ou sem.
    // Corrigido em 2026-09-22 (teste real): a regra antiga só disparava quando
    // ele PEDIA indicação e mandava perguntar "quantas pessoas" — o número que
    // não decide velocidade. Agora o gatilho inclui ele CONTAR como usa, e o
    // critério é o uso simultâneo.
    test('"qual é o melhor?" e "é assim que eu uso" disparam a mesma recomendação', () => {
      const t = texto();
      expect(t).toMatch(/quando ele pedir indicação OU quando ele contar como vai usar/);
      expect(t).toMatch(/Se as instruções trouxerem critério de recomendação, siga-o/);
      expect(t).not.toMatch(/pergunte quantas pessoas ou aparelhos vão usar/);
    });

    // Antes: ai-orchestrator.test.js:1446. O modelo antigo terminava em
    // "Algum desses planos chamou sua atenção?" — uma pergunta fechada que
    // não levava a lugar nenhum. Saiu, e não pode voltar por cópia.
    test('a abertura não termina em pergunta fechada sobre os planos', () => {
      expect(texto()).not.toMatch(/Algum desses planos chamou sua atenção\?/);
    });

    // Antes: ai-orchestrator.test.js:1463-1464 e :1466. Print 2026-09-15
    // (21:16): "tem internet em X?" → "Atendemos em X. Certo! Vou encaminhar
    // você." Confirmou e encaminhou na primeira resposta, sem planos nem
    // endereço, e com um "Certo!" que não respondia a pedido nenhum.
    test('pergunta de cobertura: confirma, emenda a venda na mesma mensagem e não encaminha na primeira resposta', () => {
      const t = texto();
      expect(t).toMatch(/Pergunta de cobertura de cliente novo \("tem internet em X\?"\): responda "Atendemos em X!" e, NA MESMA mensagem, emende a abertura de cliente novo \(planos e a pergunta de endereço\)/);
      expect(t).toMatch(/NUNCA encaminhe um cliente novo na primeira resposta se a cidade estiver na lista\./);
    });

    test('o "Certo!" só responde a um pedido do cliente; sem pedido, começa direto no encaminhamento', () => {
      expect(texto()).toMatch(/O "Certo!" é só quando ele pediu algo \(contratar, falar com atendente\); senão comece direto em "Vou encaminhar\.\.\."\./);
    });

    test('nunca nomeia um setor fixo como string literal', () => {
      expect(texto()).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
    });

    test('nunca contém nome real de cliente', () => {
      expect(texto()).not.toMatch(/Willemberg/);
    });

    test('nunca reintroduz data de nascimento, identidade fraca ou gate de confiança', () => {
      const t = texto();
      expect(t).not.toMatch(/nascimento/i);
      expect(t).not.toMatch(/identidade fraca/i);
      expect(t).not.toMatch(/gate de confiança/i);
    });

    // Rodada de correção 1 (dono, 2026-09-18): "(todos fibra)" tinha
    // escapado na frase de recomendação de plano — mesma afirmação de
    // "100% fibra óptica" que já tinha sido removida da abertura, só
    // reescrita mais adiante. Guarda direta aqui, além da guarda geral
    // ("oferta da operação") que entrou em montar.test.js por causa deste
    // achado.
    test('nunca afirma o que a operação oferece (fibra, grátis, ilimitado) — só as instruções do painel podem', () => {
      const t = texto();
      expect(t).not.toMatch(/fibra/i);
      expect(t).not.toMatch(/óptica/i);
      expect(t).not.toMatch(/grátis/i);
      expect(t).not.toMatch(/gratuit/i);
      expect(t).not.toMatch(/ilimitad/i);
    });
  });
});

describe('comercial-novo com consultar_planos disponivel', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];
  const SEM = ['buscar_cliente', 'concluir_triagem'];

  function texto(ferramentas, extra = {}) {
    return comercialNovo.linhas(estadoBase({ ferramentas, ...extra })).join('\n');
  }

  test('manda chamar a ferramenta, e NAO copiar o bloco das instrucoes', () => {
    const t = texto(COM);

    expect(t).toMatch(/chame consultar_planos/);
    expect(t).not.toMatch(/copie o bloco de planos/);
  });

  // 2026-09-22: esta guarda existe contra TROCAR valores entre planos. A
  // redação antiga ("mantendo junto o nome, a velocidade, ...") conseguia isso
  // exigindo a velocidade sempre, e era daí que vinha "500 Mega — 500 Mbps".
  // O `rotulo` pronto mantém os campos juntos por construção; a guarda
  // permanece, agora sem a exigência que criava a duplicidade.
  test('exige que a linha de um plano nao misture dados de outro', () => {
    const t = texto(COM);

    expect(t).toMatch(/Nunca monte uma linha juntando pedaços de planos diferentes/);
    expect(t).toMatch(/escreva o `rotulo` de cada plano EXATAMENTE como veio/);
  });

  test('instrucoes antigas e preco dito pelo cliente nao substituem o cadastro', () => {
    const t = texto(COM);

    expect(t).toMatch(/cliente disse ter ouvido/i);
    expect(t).toMatch(/tabela escrita nas instruções NÃO substituem/);
  });

  test('catalogo vazio ou falha nao autorizam inventar nem dizer que consultou', () => {
    const t = texto(COM);

    expect(t).toMatch(/NÃO invente e NÃO diga que consultou/);
  });

  test('cobertura passa a vir da ferramenta, sem virar "nao atendemos"', () => {
    const t = texto(COM);

    expect(t).toMatch(/chame verificar_cobertura/);
    expect(t).toMatch(/NÃO diga que não atendemos/);
    // Comportamento de venda preservado.
    expect(t).toMatch(/a pergunta de cobertura é o começo da venda, não o fim/);
    expect(t).toMatch(/Atendemos em X!/);
  });

  test('o modelo da abertura aponta para o retorno da ferramenta', () => {
    expect(texto(COM)).toContain('[os planos que consultar_planos devolveu, um por linha]');
    expect(texto(SEM)).toContain('[bloco de planos das instruções]');
  });

  // O prompt nao pode mandar chamar ferramenta que nao existe no perfil.
  test('sem a ferramenta no perfil, NAO manda chamar nada e o caminho antigo fica igual', () => {
    const t = texto(SEM);

    expect(t).not.toMatch(/chame consultar_planos/);
    expect(t).not.toMatch(/chame verificar_cobertura/);
    expect(t).toMatch(/copie o bloco de planos EXATAMENTE como está escrito nas instruções/);
  });

  test('so uma das duas disponivel nao manda chamar a outra', () => {
    const t = texto(['buscar_cliente', 'consultar_planos']);

    expect(t).toMatch(/chame consultar_planos/);
    expect(t).not.toMatch(/chame verificar_cobertura/);
  });

  // Instrucoes de producao com precos conflitantes continuam saindo no prompt
  // (painel.js), mas aqui a ordem e consultar a ferramenta.
  test('com instrucoes antigas cheias de preco, a ordem continua sendo consultar', () => {
    const t = texto(COM, {
      config: { ...estadoBase().config, triageExtraInstructions: '500 Mega por R$ 80/mês' },
    });

    expect(t).toMatch(/chame consultar_planos/);
    expect(t).not.toMatch(/copie o bloco de planos/);
  });
});

// Caso real de 2026-09-22, conversa 1f8f21c4: depois de ver os quatro planos,
// o cliente disse "Tenho 2 TVs e 7 filhos". A IA repetiu o catalogo inteiro e
// recomendou 600 Mega pela contagem de filhos.
describe('recomendacao de plano — correcao do caso real', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];

  function texto(ferramentas = COM) {
    return comercialNovo.linhas(estadoBase({ ferramentas })).join('\n');
  }

  test('contar como usa dispara a recomendacao, mesmo sem pedir indicacao', () => {
    expect(texto()).toMatch(/quando ele contar como vai usar \(pessoas, aparelhos, TVs, trabalho, jogos\), mesmo sem perguntar nada/);
  });

  test('proibe repetir a tabela ja apresentada', () => {
    const t = texto();

    expect(t).toMatch(/NÃO repita a tabela/);
    expect(t).toMatch(/repetir faz a conversa andar para trás/);
  });

  // 2026-09-22: o que voltava a tabela era a confusão entre CONSULTAR e
  // REAPRESENTAR — a ferramenta é chamada de novo (o preço tem de vir do
  // cadastro) e o modelo tratava isso como ordem de mostrar tudo outra vez.
  test('consultar de novo NAO e reapresentar', () => {
    const t = texto();

    expect(t).toMatch(/PODE chamar consultar_planos de novo para ter o preço atualizado/);
    expect(t).toMatch(/consultar NÃO é reapresentar/);
    expect(t).toMatch(/uma nova consulta não manda mostrar os planos outra vez/);
  });

  test('so reapresenta quando ele pedir para rever, comparar ou ver de novo', () => {
    expect(texto()).toMatch(/Reapresente todas as opções SÓ se ele pedir para rever, comparar ou ver os planos de novo/);
  });

  test('comparar dois planos mostra so esses dois', () => {
    expect(texto()).toMatch(/para comparar dois, mostre só esses dois/);
  });

  // A guarda antiga ("não escolha pela quantidade de pessoas ou de filhos") não
  // impediu nada em produção: trocou a REDAÇÃO da justificativa, não a
  // DECISÃO. Agora a quantidade é nomeada como insuficiente, item a item.
  test('quantidade sozinha NAO basta para escolher velocidade', () => {
    const t = texto();

    expect(t).toMatch(/QUANTIDADE NÃO É USO/);
    for (const item of ['filhos', 'pessoas na casa', 'TVs', 'celulares', 'aparelhos']) {
      expect(t).toContain(item);
    }
    expect(t).toMatch(/NÃO basta para escolher velocidade/);
    expect(t).toMatch(/uso SIMULTÂNEO/);
  });

  test('falta de informacao vira UMA pergunta util sobre uso simultaneo', () => {
    const t = texto();

    expect(t).toMatch(/faça UMA pergunta útil antes de recomendar/);
    expect(t).toMatch(/costumam ficar ligados ao mesmo tempo/);
    expect(t).toMatch(/streaming em TV, trabalho ou jogo online/);
  });

  // INVERTIDO em 2026-09-22. Este teste protegia "se o que ele já contou
  // bastar, recomende direto" — e essa discricionariedade ERA o defeito: o
  // modelo julgou que "2 TVs e 7 filhos" bastava, recomendou, e como a regra
  // também exigia "uma frase curta de motivo" tendo definido o uso simultâneo
  // como único motivo válido, ele AFIRMOU simultaneidade que ninguém disse.
  test('a discricionariedade de recomendar direto saiu', () => {
    const t = texto();

    expect(t).not.toMatch(/recomende direto/);
    expect(t).toMatch(/NÃO recomende neste mesmo turno/);
    expect(t).toMatch(/Só recomende depois que ele responder sobre o uso ao mesmo tempo/);
  });

  test('proibe inventar o uso para justificar o plano', () => {
    const t = texto();

    expect(t).toMatch(/NUNCA afirme que ele usa vários aparelhos ao mesmo tempo se ele não disse isso/);
    expect(t).toMatch(/não invente o uso para justificar o plano/);
  });

  test('o motivo da recomendacao se apoia no que ELE contou', () => {
    expect(texto()).toMatch(/uma frase curta de motivo apoiada no que ELE contou/);
  });

  test('a recomendacao leva plano, mensalidade consultada e motivo curto', () => {
    const t = texto();

    expect(t).toMatch(/diga qual plano, a mensalidade que consultar_planos devolveu e uma frase curta de motivo/);
  });

  test('proibe inventar capacidade e garantir desempenho', () => {
    const t = texto();

    expect(t).toMatch(/NUNCA invente capacidade/);
    expect(t).toMatch(/aguenta X aparelhos/);
    expect(t).toMatch(/nem garanta desempenho/);
    expect(t).toMatch(/nunca empurre o mais caro/);
  });

  test('sem a ferramenta, nao promete uma mensalidade "consultada" que nao existe', () => {
    const t = texto(['buscar_cliente', 'concluir_triagem']);

    expect(t).toMatch(/a mensalidade da fonte que você usou/);
    expect(t).not.toMatch(/consultar_planos devolveu/);
  });

  test('o resto do fluxo de venda segue intacto', () => {
    const t = texto();

    expect(t).toMatch(/Nunca encaminhe deixando uma pergunta dele sem resposta/);
    expect(t).toMatch(/Endereço é UMA pergunta só/);
    expect(t).toMatch(/O QUE PRECISA PARA FAZER O CADASTRO/);
  });
});

// Teste real de 2026-09-22, depois de ed893a7: a repetição da tabela parou,
// mas "Tenho 2 TVs e 7 filhos" virou "Vou encaminhar você para o Comercial".
// A causa estava AQUI: "ou já tiver dado o endereço" era gatilho suficiente e
// PERMANENTE — com o lugar já dito no começo da conversa, qualquer mensagem
// seguinte autorizava encerrar, inclusive um pedido de ajuda para escolher.
describe('encaminhamento — contar como usa NÃO encerra a venda', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];
  const texto = () => comercialNovo.linhas(estadoBase({ ferramentas: COM })).join('\n');

  test('ter o endereço sozinho não basta mais para encaminhar', () => {
    const t = texto();

    expect(t).toMatch(/já tiver dado o endereço E disser que quer seguir com a contratação ou a instalação/);
    // A forma antiga, incondicional, não pode voltar.
    expect(t).not.toMatch(/ou já tiver dado o endereço;/);
  });

  test('o caso observado é nomeado: contar como usa é pedido de ajuda', () => {
    const t = texto();

    expect(t).toMatch(/contar como usa.*NÃO é pedido de encaminhamento/);
    expect(t).toMatch(/pedido de ajuda para escolher/);
  });

  test('e aponta de volta para a RECOMENDAÇÃO, sem reescrevê-la', () => {
    const t = texto();

    expect(t).toMatch(/já ter o endereço não autoriza encerrar aí — siga a RECOMENDAÇÃO acima/);
    // Uma regra só: a orientação de como recomendar continua aparecendo uma
    // única vez, no bloco RECOMENDAÇÃO.
    expect(t.match(/faça UMA pergunta útil/g)).toHaveLength(1);
  });

  test('os gatilhos legítimos de encaminhamento continuam de pé', () => {
    const t = texto();

    expect(t).toMatch(/ele escolher um plano ou pedir para contratar/);
    expect(t).toMatch(/ou pedir para falar com um atendente/);
    expect(t).toMatch(/ou a cidade não estiver na lista/);
  });
});

// Regressão do atendimento inteiro, na ordem em que aconteceu. Não roda o
// modelo (sem chamada paga): prova que o PROMPT que ele recebe manda fazer o
// que o dono espera em cada passo.
describe('regressão do atendimento de 2026-09-22 (planos → uso → recomendação)', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];
  const t = () => comercialNovo.linhas(estadoBase({ ferramentas: COM })).join('\n');

  test('passo 1 — "quais os planos para instalar lá": apresenta os planos sem encerrar', () => {
    expect(t()).toMatch(/NUNCA encaminhe um cliente novo na primeira resposta quando a ferramenta disser que atendemos/);
  });

  test('passo 2 — "tenho 2 TVs e 7 filhos": NÃO repete a tabela', () => {
    const texto = t();

    expect(texto).toMatch(/NÃO repita a tabela/);
    // A nova consulta ao catálogo (obrigatória, o preço vem do cadastro) não
    // autoriza mostrar tudo de novo — era exatamente isso que acontecia.
    expect(texto).toMatch(/consultar NÃO é reapresentar/);
  });

  test('passo 2 — NÃO encaminha', () => {
    expect(t()).toMatch(/contar como usa.*NÃO é pedido de encaminhamento/);
  });

  test('passo 2 — NÃO escolhe pelo número de filhos nem de TVs', () => {
    const texto = t();

    expect(texto).toMatch(/QUANTIDADE NÃO É USO/);
    expect(texto).toMatch(/"tenho 2 TVs e 7 filhos" é quantidade, não uso/);
  });

  test('passo 2 — NÃO recomenda ainda', () => {
    expect(t()).toMatch(/NÃO recomende neste mesmo turno/);
  });

  test('passo 2 — faz no máximo UMA pergunta sobre uso simultâneo', () => {
    const texto = t();

    expect(texto).toMatch(/faça UMA pergunta útil antes de recomendar/);
    expect(texto).toMatch(/costumam ficar ligados ao mesmo tempo/);
  });

  test('passo 3 — com a resposta, recomenda UMA opção com mensalidade e motivo', () => {
    expect(t()).toMatch(/diga qual plano, a mensalidade que consultar_planos devolveu e uma frase curta de motivo/);
  });
});

describe('apresentação dos planos — sem velocidade repetida', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];
  const texto = (ferramentas = COM) => comercialNovo.linhas(estadoBase({ ferramentas })).join('\n');

  test('manda usar o rotulo pronto, um por linha', () => {
    const t = texto();

    expect(t).toMatch(/um plano por linha começando com "• "/);
    expect(t).toMatch(/escreva o `rotulo` de cada plano EXATAMENTE como veio/);
  });

  test('proíbe acrescentar a velocidade por conta própria', () => {
    expect(texto()).toMatch(/nunca acrescente a velocidade a um rótulo que não a traz/);
  });

  test('a instalação comum sai UMA vez, fora das linhas', () => {
    expect(texto()).toMatch(/com `instalacaoComum`, escreva a instalação UMA vez depois da lista, nunca por linha/);
  });

  test('o formato antigo, que produzia a velocidade repetida, saiu', () => {
    expect(texto()).not.toMatch(/mantendo junto o nome, a velocidade, a mensalidade e a instalação/);
  });

  test('a guarda contra trocar valores entre planos continua', () => {
    expect(texto()).toMatch(/Nunca monte uma linha juntando pedaços de planos diferentes/);
  });

  test('sem a ferramenta, o texto de reserva das instruções segue intacto', () => {
    const t = texto(['buscar_cliente', 'concluir_triagem']);

    expect(t).toMatch(/copie o bloco de planos EXATAMENTE como está escrito nas instruções/);
    expect(t).not.toMatch(/rotulo/);
  });
});

// Teste real de 2026-09-22, DEPOIS de c29c6d1: a apresentação inicial saiu
// certa, mas "Tenho 2 TVs e 7 filhos" fez a IA recomendar 600 Mega, repetir o
// catálogo inteiro e justificar com "vários aparelhos ao mesmo tempo" — que o
// cliente nunca disse. O turno inteiro, passo a passo, sem chamar a OpenAI.
describe('caso real 2026-09-22: turno 2 nao lista, nao recomenda, nao transfere', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];
  const t = () => comercialNovo.linhas(estadoBase({ ferramentas: COM })).join('\n');

  test('turno 1 — pedir os planos permite apresentar todos', () => {
    const texto = t();

    expect(texto).toMatch(/Liste o catálogo|Reapresente todas as opções|Temos estes planos/);
    expect(texto).toMatch(/\[os planos que consultar_planos devolveu, um por linha\]/);
  });

  test('turno 2 — consultar de novo e permitido, reapresentar nao', () => {
    const texto = t();

    expect(texto).toMatch(/PODE chamar consultar_planos de novo para ter o preço atualizado/);
    expect(texto).toMatch(/uma nova consulta não manda mostrar os planos outra vez/);
  });

  test('turno 2 — exige UMA pergunta sobre uso simultaneo', () => {
    const texto = t();

    expect(texto).toMatch(/faça UMA pergunta útil antes de recomendar/);
    expect(texto).toMatch(/costumam ficar ligados ao mesmo tempo/);
  });

  test('turno 2 — NAO recomenda ainda', () => {
    const texto = t();

    expect(texto).toMatch(/NÃO recomende neste mesmo turno/);
    expect(texto).toMatch(/Só recomende depois que ele responder sobre o uso ao mesmo tempo/);
  });

  test('turno 2 — NAO inventa o uso simultaneo', () => {
    expect(t()).toMatch(/NUNCA afirme que ele usa vários aparelhos ao mesmo tempo se ele não disse isso/);
  });

  test('turno 2 — NAO transfere para o setor de vendas', () => {
    expect(t()).toMatch(/contar como usa.*NÃO é pedido de encaminhamento/);
  });

  test('"me mostra os planos de novo" reapresenta o catalogo', () => {
    expect(t()).toMatch(/Reapresente todas as opções SÓ se ele pedir para rever, comparar ou ver os planos de novo/);
  });

  test('"compara 600 e 800" mostra so esses dois', () => {
    expect(t()).toMatch(/para comparar dois, mostre só esses dois/);
  });

  test('o preco continua vindo do cadastro, nunca da conversa', () => {
    const texto = t();

    expect(texto).toMatch(/chame consultar_planos/);
    expect(texto).toMatch(/valor que apareceu antes na conversa ou tabela escrita nas instruções NÃO substituem o que a ferramenta devolveu/);
  });
});

// Teste real de 2026-09-22, terceira rodada. Depois de confirmar cobertura,
// apresentar planos, perguntar sobre uso simultâneo e recomendar 700 Mega, o
// cliente disse "Ok muito obrigado" — e a IA respondeu "Vou encaminhar você
// para o Comercial".
//
// A causa foi o qualificador "E não houver mais nada de venda para tratar",
// posto na rodada anterior para impedir o encaminhamento no MEIO da venda.
// Ele resolveu o meio e quebrou o fim: um agradecimento é a leitura mais clara
// possível de "não há mais nada a tratar".
describe('caso real: agradecer NAO e intencao de contratar', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];
  const t = () => comercialNovo.linhas(estadoBase({ ferramentas: COM })).join('\n');

  test('a clausula do endereco agora exige INTENCAO, nao ausencia de assunto', () => {
    const texto = t();

    expect(texto).toMatch(/já tiver dado o endereço E disser que quer seguir com a contratação ou a instalação/);
    // A forma que transformou "Ok obrigado" em encaminhamento nao pode voltar.
    expect(texto).not.toMatch(/não houver mais nada de venda para tratar/);
  });

  test('"ok", "obrigado", "valeu", "entendi" nao sao gatilho', () => {
    const texto = t();

    for (const palavra of ['"ok"', '"obrigado"', '"valeu"', '"entendi"']) {
      expect(texto).toContain(palavra);
    }
    expect(texto).toMatch(/NÃO é escolha de plano, NÃO é pedido para contratar e NÃO é pedido de atendente/);
  });

  test('agradecimento nao encaminha NEM conclui a triagem', () => {
    expect(t()).toMatch(/não encaminhe e não conclua por causa disso/);
  });

  test('a resposta e cordial e deixa a porta aberta', () => {
    const texto = t();

    expect(texto).toMatch(/Responda curto e cordial, deixando a porta aberta/);
    expect(texto).toMatch(/Se quiser seguir com a instalação, é só me chamar/);
  });

  test('so encaminha com intencao dita com todas as letras', () => {
    const texto = t();

    for (const frase of ['quero contratar', 'pode instalar', 'vamos fechar', 'quero esse plano']) {
      expect(texto).toContain(frase);
    }
    expect(texto).toMatch(/Só encaminhe quando ele disser com todas as letras que quer avançar/);
  });

  test('os gatilhos legitimos continuam de pe', () => {
    const texto = t();

    expect(texto).toMatch(/ele escolher um plano ou pedir para contratar/);
    expect(texto).toMatch(/ou pedir para falar com um atendente/);
    expect(texto).toMatch(/ou a cidade não estiver na lista/);
  });

  // As tres rodadas anteriores do mesmo atendimento continuam protegidas.
  test('o resto do fluxo comercial segue intacto', () => {
    const texto = t();

    expect(texto).toMatch(/QUANTIDADE NÃO É USO/);
    expect(texto).toMatch(/consultar NÃO é reapresentar/);
    expect(texto).toMatch(/contar como usa.*NÃO é pedido de encaminhamento/);
    expect(texto).toMatch(/chame consultar_planos/);
    expect(texto).toMatch(/chame verificar_cobertura/);
  });
});
