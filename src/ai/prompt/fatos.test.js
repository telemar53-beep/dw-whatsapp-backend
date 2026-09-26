const fatos = require('./fatos');
const { estadoBase } = require('./estado-de-teste');

describe('módulo fatos', () => {
  test('entra sempre, independente do estado', () => {
    expect(fatos.entra(estadoBase())).toBe(true);
  });

  test('data e hora vêm de estado.agora (determinístico), nunca do relógio', () => {
    const texto = fatos.linhas(estadoBase({ agora: new Date('2026-09-17T14:00:00.000Z') })).join('\n');
    expect(texto).toContain('Hoje é 17/09/2026 e agora são 11:00 em Brasília.');
  });

  // Task 18 — antes: ai-orchestrator.test.js:1879. A hora sozinha não resolve:
  // o modelo não tem relógio E não sabe onde cada saudação começa. Sem a
  // tabela de faixas ele cumprimenta errado (ou não cumprimenta).
  test('a hora vem acompanhada da faixa de cada saudação', () => {
    const texto = fatos.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/Saudação: "Bom dia" até 11:59, "Boa tarde" de 12:00 a 17:59, "Boa noite" depois\./);
  });

  test('cumprimenta só na primeira resposta e não repete saudação depois', () => {
    const texto = fatos.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/Cumprimente só na primeira resposta da conversa; nas seguintes, não repita a saudação/);
  });

  // Rodada de correção 3 (dono, 2026-09-18): a linha dizia "diga que o
  // Comercial confirma e encaminhe" — nome de setor fixo, violando a
  // Restrição Global do plano ("nomes de setor e motivo nunca aparecem como
  // string literal"). Numa operação sem um setor chamado "Comercial" a frase
  // afirmaria algo que não existe na lista real (injetada por painel.js).
  test('sem instruções da operação, aponta para o setor da lista em vez de nomear "Comercial"', () => {
    const texto = fatos.linhas(estadoBase()).join('\n');
    // Sem "da lista acima": fatos é o único módulo que vem ANTES de painel na
    // ordem de composição, então uma referência posicional aqui apontaria para
    // baixo — o defeito que o ajuste de ordem consertou no resto do prompt.
    expect(texto).toMatch(/não invente: diga que a equipe confirma e encaminhe para o setor que cuidar de vendas\./);
    expect(texto).not.toMatch(/lista acima/);
    expect(texto).not.toMatch(/\b(Financeiro|Comercial|Suporte|Reativação)\b/);
  });

  // Task 18 — antes: ai-orchestrator.test.js:710. A outra metade da mesma
  // regra: preço, planos e cobertura saem SÓ das instruções da operação, e
  // exatamente como estão lá. O teste acima cobre o "e se não houver"; este
  // cobre a fonte única em si, que é o que impede a IA de inventar plano.
  test('preço, planos e cobertura vêm SOMENTE das instruções da operação, exatamente como estão lá', () => {
    const texto = fatos.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/Preço, planos e cobertura: informe SOMENTE o que estiver escrito nas INSTRUÇÕES ADICIONAIS DA OPERAÇÃO abaixo, exatamente como está lá\./);
  });

  // Task 18 — antes: ai-orchestrator.test.js:1141-1142. Uma das 7 lacunas
  // apontadas pelo despacho (regra presente no compositor, sem teste).
  // O encaminhamento não se anuncia antes de acontecer: "me diga qual
  // problema para eu encaminhar ao setor correto" expõe o funcionamento
  // interno e transforma a pergunta num aviso de que ninguém vai atender.
  test('o esclarecimento pergunta o que se precisa saber, sem anunciar encaminhamento', () => {
    const texto = fatos.linhas(estadoBase()).join('\n');
    expect(texto).toMatch(/Ao pedir um esclarecimento, pergunte direto o que você precisa saber/);
    expect(texto).toMatch(/nunca "me diga qual problema para eu encaminhar ao setor correto"/);
    expect(texto).toMatch(/O encaminhamento não se anuncia antes de acontecer\./);
  });

  describe('SGP indisponível', () => {
    test('cumprimenta pelo nome da memória, sem pedir CPF nem tentar boleto/PIX', () => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: 'Maria', contracts: [], contestado: false, sgpIndisponivel: true },
      })).join('\n');
      expect(texto).toMatch(/Cliente identificado pela memória \(primeiro nome Maria\), mas o sistema do SGP NÃO respondeu agora/);
      expect(texto).toMatch(/NÃO peça CPF e NÃO tente boleto, PIX nem status de conexão/);
      expect(texto).toMatch(/SGP indisponível na triagem/);
    });

    test('sem primeiro nome, usa o fallback "cliente"', () => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel: 'forte', origem: 'memory', primeiroNome: null, contracts: [], contestado: false, sgpIndisponivel: true },
      })).join('\n');
      expect(texto).toMatch(/primeiro nome cliente\)/);
    });
  });

  describe('cliente não identificado', () => {
    // Rodada de correção 4 (dono, 2026-09-18, Task 14): fatos.js diz o FATO
    // ("o cliente ainda não foi identificado"); o QUE FAZER a respeito
    // (pedir CPF/CNPJ, tratar a contestação) virou conteúdo de
    // fluxos/identificacao.js — instrução de fluxo não é fato. Ver o teste
    // equivalente em identificacao.test.js e a guarda-tripwire abaixo, em
    // 'guardas de princípio'.
    test('só constata o estado, sem instruir o que fazer a respeito', () => {
      const texto = fatos.linhas(estadoBase()).join('\n');
      expect(texto).toMatch(/Cliente NÃO identificado\./);
      expect(texto).not.toMatch(/Peça o CPF/);
    });
  });

  describe('cliente identificado (forte)', () => {
    function estadoIdentificado(extraIdentidade = {}, contratos = []) {
      return estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false, ...extraIdentidade },
        contratos,
      });
    }

    test('saudação sempre na primeira resposta, com o primeiro nome', () => {
      const texto = fatos.linhas(estadoIdentificado()).join('\n');
      expect(texto).toMatch(/Cliente identificado \(telefone\): primeiro nome João/);
      expect(texto).toMatch(/A PRIMEIRA resposta desta conversa começa SEMPRE com a saudação da hora e o primeiro nome \("Bom dia, João!"\)/);
    });

    test('sem primeiro nome, usa o fallback "cliente" e não aparece "null"', () => {
      const texto = fatos.linhas(estadoIdentificado({ primeiroNome: null })).join('\n');
      expect(texto).toMatch(/primeiro nome cliente\./);
      expect(texto).not.toMatch(/null/);
    });

    test('origem memória e CPF também aparecem traduzidas', () => {
      const memoria = fatos.linhas(estadoIdentificado({ origem: 'memory' })).join('\n');
      expect(memoria).toMatch(/Cliente identificado \(memória\)/);

      const cpf = fatos.linhas(estadoIdentificado({ origem: 'cpf' })).join('\n');
      expect(cpf).toMatch(/Cliente identificado \(CPF\)/);
    });

    test('sem contratos, não lista "Contratos dele:"', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [])).join('\n');
      expect(texto).not.toContain('Contratos dele:');
    });

    test('um contrato só: lista e diz para usar sem perguntar qual', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 101, plano: 'Plano X', velocidade: '500 Mega', endereco: 'Rua das Flores, 10', status: 'ativo' },
      ])).join('\n');
      expect(texto).toContain('Contratos dele:');
      expect(texto).toContain('- contrato 101 — Plano X (500 Mega) — Rua das Flores, 10 — ativo');
      expect(texto).toMatch(/Contrato único: use-o sem perguntar qual\./);
    });

    test('contrato sem velocidade e sem endereço usa os textos de fallback', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 55, plano: 'Plano Y', velocidade: null, endereco: null, status: 'suspenso' },
      ])).join('\n');
      expect(texto).toContain('- contrato 55 — Plano Y — endereço não informado — suspenso');
    });

    test('múltiplos contratos: lista todos e NÃO diz "contrato único"', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 1, plano: 'A', velocidade: null, endereco: 'Rua A', status: 'ativo' },
        { id: 2, plano: 'B', velocidade: null, endereco: 'Rua B', status: 'ativo' },
      ])).join('\n');
      expect(texto).toContain('- contrato 1 — A — Rua A — ativo');
      expect(texto).toContain('- contrato 2 — B — Rua B — ativo');
      expect(texto).not.toMatch(/Contrato único/);
      expect(texto).toMatch(/pergunte de uma vez pelo endereço, citando os endereços/);
    });

    // Task 18 — antes: ai-orchestrator.test.js:671. A desambiguação só
    // funciona se o modelo souber COMO citar os endereços; e ela é
    // condicional: só quando a resposta depender do ponto.
    test('a desambiguação traz o exemplo de como citar os endereços, e só quando o ponto importa', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 1, plano: 'A', velocidade: null, endereco: 'Rua A', status: 'ativo' },
        { id: 2, plano: 'B', velocidade: null, endereco: 'Rua B', status: 'ativo' },
      ])).join('\n');
      expect(texto).toContain('("é o da Rua X ou o da Av. Y?")');
      expect(texto).toMatch(/Pergunte SÓ quando a resposta depender do ponto\./);
    });

    test('nunca cita o número do contrato ao cliente nem pede para escolher pelo número', () => {
      const texto = fatos.linhas(estadoIdentificado({}, [
        { id: 1, plano: 'A', velocidade: null, endereco: 'Rua A', status: 'ativo' },
      ])).join('\n');
      expect(texto).toMatch(/Nunca peça o número do contrato nem pergunte "qual contrato": o cliente não sabe\. NUNCA cite o número do contrato ao cliente\./);
    });

    test('permite dizer atraso em dias\\/meses e quantidade de faturas, mas nunca o valor', () => {
      const texto = fatos.linhas(estadoIdentificado()).join('\n');
      // Regra 0/1/2+ (25/09/2026): "em aberto" contava o carnê futuro inteiro. Atraso é só o que
      // venceu pela data ORIGINAL, e a quantidade é o faturasVencidas da ferramenta.
      expect(texto).toMatch(/Com identidade confirmada você pode dizer há quantos dias\/meses a fatura está vencida e quantas faturas estão vencidas/);
      expect(texto).toMatch(/pelo vencimento ORIGINAL, nunca pelo atualizado/);
      expect(texto).toMatch(/Fatura que vence hoje, fatura futura \(o carnê\) e fatura paga NÃO são atraso/);
      expect(texto).not.toMatch(/quantas faturas estão em aberto/);
      expect(texto).toMatch(/Continua proibido dizer o VALOR\./);
      expect(texto).toMatch(/NUNCA diga ao cliente: valores e vencimentos de faturas, plano contratado ou endereço/);
    });

    // Task 18 — antes: ai-orchestrator.test.js:1506. A proibição acima tem
    // três exceções, todas só com identidade confirmada — e a terceira é a
    // que autoriza o fluxo de diagnóstico a dizer status. Sem esta metade, o
    // roteiro de suporte inteiro fica proibido por engano.
    test('as três exceções à proibição de falar da conta estão explícitas, e só com identidade confirmada', () => {
      const texto = fatos.linhas(estadoIdentificado()).join('\n');
      expect(texto).toMatch(/Exceções, SÓ com identidade confirmada: perguntar de qual ponto ele fala, dizer se existe ou não fatura em aberto, e dizer o status do contrato e da conexão no fluxo de SUPORTE abaixo\./);
      expect(texto).toMatch(/Nunca diga "pagamento confirmado"; nunca prometa prazos ou "um técnico vai"\./);
    });
  });

  describe('guardas de princípio (não reintroduzir o que foi removido)', () => {
    // Rodada de correção 1 (dono, 2026-09-18): privacidade e terceiros são
    // conteúdo de fluxos/privacidade.js e fluxos/terceiros.js (Task 13), não
    // de fatos.js — deixá-los aqui duplicaria o bloco quando a Task 13
    // preencher os dois módulos. O texto original em ai-orchestrator.js tem
    // dois nomes reais de cliente ("Laureny", "Jureildson"); a guarda abaixo
    // também serve de tripwire para eles não voltarem por aqui.
    test.each(['none', 'forte'])('não emite mais o bloco de privacidade/terceiros (identidade %s)', (nivel) => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel, origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false },
      })).join('\n');
      expect(texto).not.toMatch(/DADOS DE OUTRA PESSOA/);
      expect(texto).not.toMatch(/titularEOutraPessoa/);
    });

    // Rodada de correção 4 (dono, 2026-09-18, Task 14): pedir CPF/CNPJ e a
    // aftermath da contestação são conteúdo de fluxos/identificacao.js agora
    // (entra() condicional: nivel === 'none' ou contestado) — mesmo
    // raciocínio que já tirou privacidade/terceiros daqui na Task 13.
    test('não pede CPF/CNPJ nem cita identificação descartada: isso é conteúdo de fluxos/identificacao.js', () => {
      const semContestar = fatos.linhas(estadoBase()).join('\n');
      expect(semContestar).not.toMatch(/Peça o CPF ou CNPJ/);

      const comContestar = fatos.linhas(estadoBase({
        identidade: { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: true },
      })).join('\n');
      expect(comContestar).not.toMatch(/identificação foi descartada/);
    });

    test('nunca contém nome real de cliente (só marcador ou nome de teste genérico)', () => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false },
      })).join('\n');
      expect(texto).not.toMatch(/Laureny/);
      expect(texto).not.toMatch(/Jureildson/);
    });

    test('nunca menciona data de nascimento em nenhum cenário', () => {
      for (const identidade of [
        { nivel: 'none', origem: 'none', primeiroNome: null, contracts: [], contestado: false },
        { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false },
        { nivel: 'forte', origem: 'memory', primeiroNome: 'João', contracts: [], contestado: false, sgpIndisponivel: true },
      ]) {
        const texto = fatos.linhas(estadoBase({ identidade })).join('\n');
        expect(texto).not.toMatch(/nascimento/i);
      }
    });

    test('não existe ramo de identidade fraca: só none, forte e sgpIndisponivel são tratados', () => {
      const texto = fatos.linhas(estadoBase({
        identidade: { nivel: 'fraca', origem: 'phone', primeiroNome: 'João', contracts: [], contestado: false },
      })).join('\n');
      // Sem tratamento próprio, 'fraca' cai no mesmo ramo de identidade
      // confirmada (else) que 'forte' — não existe um terceiro caminho.
      expect(texto).toMatch(/Cliente identificado \(telefone\): primeiro nome João/);
    });
  });
});
