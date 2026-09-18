const { montarContexto, MODULOS } = require('./montar');
const { estadoBase } = require('./estado-de-teste');

test('a ordem de montagem começa pelo prompt do sistema e põe os princípios em seguida', () => {
  const texto = montarContexto(estadoBase());
  expect(texto.indexOf('Você é a assistente da empresa.')).toBe(0);
  expect(texto.indexOf('PRIORIDADE')).toBeGreaterThan(0);
  expect(texto.indexOf('PRIORIDADE')).toBeLessThan(texto.indexOf('Setores'));
});

test('as instruções da operação vêm com a frase de precedência no cabeçalho', () => {
  const texto = montarContexto(estadoBase({
    config: { systemPrompt: 'p', triageExtraInstructions: 'Planos: 500 Mega R$ 100', triageResolvedReasonId: null },
  }));
  expect(texto).toContain('Planos: 500 Mega R$ 100');
  const cabecalho = texto.slice(texto.indexOf('INSTRUÇÕES ADICIONAIS') - 400, texto.indexOf('Planos: 500'));
  expect(cabecalho).toMatch(/vale o princípio/i);
});

test('cliente não identificado não recebe nenhum roteiro de cliente identificado', () => {
  const texto = montarContexto(estadoBase());
  expect(texto).not.toMatch(/consultar_status_todos_contratos/);
  expect(texto).not.toMatch(/REATIVAÇÃO/);
});

test('cliente identificado não recebe a abertura de cliente novo', () => {
  const texto = montarContexto(estadoBase({
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
    contratos: [{ id: 1, plano: 'X', status: 'ativo', endereco: 'Rua A' }],
  }));
  expect(texto).not.toMatch(/bloco de planos das instruções/);
});

// Este teste olha a SELEÇÃO, não o conteúdo: privacidade e terceiros são os dois
// módulos que entram em qualquer estado de identidade. O texto deles é a tarefa
// seguinte — aqui eles ainda são esqueleto, então asserir a frase faria a Task 12
// ter de escrever conteúdo da Task 13 e acabaria duplicando o bloco nos dois lugares.
test('privacidade e terceiros são selecionados nos dois estados de identidade', () => {
  const privacidade = MODULOS.find((m) => m.nome === 'privacidade');
  const terceiros = MODULOS.find((m) => m.nome === 'terceiros');
  for (const nivel of ['none', 'forte']) {
    const estado = estadoBase({ identidade: { nivel, origem: 'phone', primeiroNome: '[nome]', contracts: [], contestado: false } });
    expect(privacidade.entra(estado)).toBe(true);
    expect(terceiros.entra(estado)).toBe(true);
  }
});

test('todo módulo declara nome, entra e linhas', () => {
  for (const m of MODULOS) {
    expect(typeof m.nome).toBe('string');
    expect(typeof m.entra).toBe('function');
    expect(typeof m.linhas).toBe('function');
  }
});

// Rodada de correção 3 (dono, 2026-09-18): a guarda de dado operacional
// (Rodada 2) só olhava principios.js. Nomes de setor fixo entraram por
// fatos.js e painel.js sem que nenhum teste pegasse. Esta guarda varre TODOS
// os módulos — para travar a regra também para as Tasks 13-17, que ainda vão
// escrever o conteúdo real de cada fluxo.
//
// Estados variados de propósito (não só não-identificado/identificado): cada
// um liga uma condição diferente (aviso de cidade, noturno, limite de
// perguntas, SGP indisponível, terceiro, múltiplos contratos) para que,
// quando uma tarefa futura ligar o entra() de um fluxo hoje esqueleto, esta
// varredura já passe a cobrir o conteúdo dele também.
const ESTADOS_PARA_VARREDURA = [
  estadoBase(),
  estadoBase({
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: '[nome]', contracts: [{ id: 1 }], contestado: false },
    contratos: [{ id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço]', status: 'ativo' }],
  }),
  estadoBase({
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: '[nome]', contracts: [{ id: 1 }, { id: 2 }], contestado: false },
    contratos: [
      { id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço 1]', status: 'ativo' },
      { id: 2, plano: '[plano]', velocidade: null, endereco: '[endereço 2]', status: 'suspenso' },
    ],
  }),
  estadoBase({
    identidade: { nivel: 'forte', origem: 'memory', primeiroNome: '[nome]', contracts: [], contestado: false, sgpIndisponivel: true },
  }),
  estadoBase({ avisoCidade: { cidade: '[cidade]', mensagem: '[mensagem]' } }),
  estadoBase({ triagem: { noturno: { ativo: true, retornoAs: '[hora]' }, forcarConclusao: false } }),
  estadoBase({ triagem: { noturno: { ativo: false }, forcarConclusao: true } }),
  estadoBase({ terceiro: { titular: '[nome do titular]' } }),
];

// painel.js fica de fora de propósito, não por afrouxamento: o trabalho DELE
// é repassar dado que vem do operador/banco — a listagem de setores
// (estado.setores, que legitimamente contém "Suporte", "Comercial" etc. como
// dado, não como o módulo decidindo isso) e o texto de
// config.triageExtraInstructions (que legitimamente contém preço). painel.js
// não decide nenhum desses valores, só formata o que recebe — é o único
// módulo cujo trabalho é exatamente esse repasse. NÃO tire esta exclusão sem
// entender isso; se precisar testar painel.js especificamente, o teste dele
// já cobre isso em painel.test.js (checando só a frase de fallback, não a
// listagem de setores).
// Esta lista NÃO é exaustiva — cada padrão entrou depois de uma categoria
// de dado da operação reincidir de verdade numa migração; ela não substitui
// o julgamento de quem migra cada módulo, só pega as reincidentes.
//
// Achado real (Task 14, rodada de revisão 1, 2026-09-18): "(todos fibra)"
// escapou de comercial-novo.js porque nenhum padrão cobria afirmação sobre
// O QUE A OPERAÇÃO OFERECE — só velocidade, preço e nome de setor estavam
// aqui. É a mesma categoria de "100% fibra óptica" e "Instalação grátis."
// que a Restrição Global já proíbe, só reescrita mais adiante no mesmo
// parágrafo original. As três tarefas restantes (fluxos de suporte e
// financeiro) vão migrar muito mais texto onde essa categoria pode
// reaparecer — por isso o padrão cobre um radical, não só "fibra".
//
// Ressalva IMPORTANTE: se um módulo futuro precisar legitimamente de uma
// destas palavras dentro de uma PROIBIÇÃO ("não afirme que os planos são
// fibra"), esta guarda VAI reprovar a linha inteira — ela não olha negação,
// só presença da palavra. O conserto correto nesse caso é reescrever a frase
// sem a palavra (mesma solução já usada para "parentesco" em
// terceiros.js/terceiros.test.js, ver comentário lá). NUNCA afrouxe ou
// remova um padrão daqui para fazer uma linha passar — isso reabriria
// exatamente o buraco que este achado fechou.
const NOME_DOS_REGEX = [
  ['velocidade', /\d+\s*mega/i],
  ['preço', /R\$\s*\d/],
  ['nome de setor', /\b(Financeiro|Comercial|Suporte|Reativação)\b/],
  ['oferta da operação', /fibra|óptica|grátis|gratuit|ilimitad/i],
];

test('nenhum módulo (exceto painel, que repassa dado do operador) hardcoda velocidade, preço ou nome de setor', () => {
  const violacoes = [];
  for (const modulo of MODULOS) {
    if (modulo.nome === 'painel') continue;
    for (const estado of ESTADOS_PARA_VARREDURA) {
      if (!modulo.entra(estado)) continue;
      modulo.linhas(estado).forEach((linha, indice) => {
        for (const [rotulo, regex] of NOME_DOS_REGEX) {
          if (regex.test(linha)) {
            violacoes.push(`módulo "${modulo.nome}", linha [${indice}] — ${rotulo} hardcoded: "${linha}"`);
          }
        }
      });
    }
  }
  expect(violacoes).toEqual([]);
});
