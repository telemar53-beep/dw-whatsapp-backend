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

// =====================================================================
// Task 18 — asserts de COMPOSIÇÃO migrados de ai-orchestrator.test.js
// =====================================================================
// Estes seis asserts não eram sobre o conteúdo de um módulo: eram sobre QUAL
// módulo entra em QUAL estado. No construtor antigo isso só dava para testar
// pelo texto do prompt inteiro; aqui é o próprio contrato do compositor.

// Antes: ai-orchestrator.test.js:581 e :630. O bloco noturno é o que autoriza
// a IA a atender sozinha e a prometer o retorno da equipe: de dia ele não pode
// existir, nem quando a leitura de comprovante de dia está ligada (a flag
// acrescenta UMA ferramenta, não o modo noturno).
test('de dia o prompt não tem o bloco noturno, nem com a leitura de comprovante de dia ligada', () => {
  expect(montarContexto(estadoBase())).not.toMatch(/MODO NOTURNO/);
  const comLeituraDeDia = montarContexto(estadoBase({
    ferramentas: ['buscar_cliente', 'concluir_triagem', 'analisar_comprovante'],
    triagem: { noturno: { ativo: false }, forcarConclusao: false },
  }));
  expect(comLeituraDeDia).not.toMatch(/MODO NOTURNO/);
  expect(comLeituraDeDia).toMatch(/chame analisar_comprovante/);
});

// Antes: ai-orchestrator.test.js:794 e :797. Teste real 2026-09-13: cliente já
// vinculado ouviu "me informe seu CPF" porque o SGP não respondeu. Com
// sgpIndisponivel a identidade CONTINUA valendo — o que cai são os módulos que
// dependeriam do SGP. Pedir CPF de novo a quem já foi chamado pelo nome é o
// pior desfecho possível.
test('com SGP indisponível, nem o pedido de documento nem o fluxo financeiro entram', () => {
  const texto = montarContexto(estadoBase({
    identidade: { nivel: 'forte', origem: 'memory', primeiroNome: '[nome]', contracts: [], contestado: false, sgpIndisponivel: true },
  }));
  expect(texto).not.toMatch(/me informe seu CPF ou CNPJ/);
  expect(texto).not.toMatch(/Identidade JÁ confirmada/);
  // E o que SOBRA é o único caminho possível: cumprimentar, avisar, encaminhar.
  expect(texto).toMatch(/SGP indisponível na triagem/);
});

// Antes: ai-orchestrator.test.js:1867-1868. Sem falha regional ativa, nenhuma
// das duas linhas do aviso pode aparecer: elas suprimem o roteiro de
// diagnóstico inteiro, e suprimi-lo sem motivo deixa o cliente sem atendimento.
test('sem aviso de cidade, nenhuma linha de falha regional entra no prompt', () => {
  const texto = montarContexto(estadoBase());
  expect(texto).not.toMatch(/AVISO ATIVO PARA/);
  expect(texto).not.toMatch(/falha regional em andamento/);
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
  // Task 16 (financeiro.js): com motivo de encerramento configurado, a
  // despedida de boleto/PIX vem por um ramo do ternário que nenhum estado
  // acima liga (nenhum outro define config.triageResolvedReasonId) — sem
  // este estado, a guarda varreria sempre o mesmo ramo do módulo e nunca
  // chegaria a ler a despedida com "[nome]".
  estadoBase({
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: '[nome]', contracts: [{ id: 1 }], contestado: false },
    contratos: [{ id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço]', status: 'ativo' }],
    config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: '[motivo]' },
  }),
  // Rodada de correção 3 (Task 17): o mesmo buraco que a Task 16 fechou para
  // financeiro.js existia para limite-perguntas.js — o estado que liga
  // forcarConclusao: true (acima) usa a config padrão (triageResolvedReasonId:
  // null), e o estado com triageResolvedReasonId definido (logo acima) tem
  // forcarConclusao: false. Sem um estado que combine os dois, a guarda
  // varreria sempre o mesmo ramo do ternário de limite-perguntas.js — o ramo
  // com motivo (o "conclua sozinha" de config.triageResolvedReasonId) nunca
  // seria lido.
  estadoBase({
    triagem: { noturno: { ativo: false }, forcarConclusao: true },
    config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: '[motivo]' },
  }),
  // Task 17 (comprovante.js): a lista padrão de estado-de-teste.js
  // (`ferramentas: ['buscar_cliente', 'concluir_triagem']`) nunca inclui
  // 'analisar_comprovante' — sem um estado que a acrescente, comprovante.entra()
  // seria false em toda a varredura e o conteúdo do módulo (os dois ramos,
  // noturno e diurno — texto diferente em cada um) nunca seria varrido. Dois
  // estados, um por ramo. (Nota, Rodada de correção 1: comprovante.entra()
  // depois virou sempre `true` — ver abaixo —, então esses dois estados já
  // não são mais indispensáveis para ALCANÇAR o módulo, mas continuam
  // exercitando especificamente os ramos COM a ferramenta, dia e noite.)
  estadoBase({
    ferramentas: ['buscar_cliente', 'concluir_triagem', 'analisar_comprovante', 'desbloqueio_confianca'],
    triagem: { noturno: { ativo: true, retornoAs: '[hora]' }, forcarConclusao: false },
  }),
  estadoBase({
    ferramentas: ['buscar_cliente', 'concluir_triagem', 'analisar_comprovante'],
    triagem: { noturno: { ativo: false }, forcarConclusao: false },
  }),
  // Task 17, Rodada de correção 1 (coordenador): nenhum estado acima combina
  // identidade FORTE com noturno ativo — os únicos estados noturnos da lista
  // têm identidade 'none' (default). Sem um estado assim, o ramo noturno de
  // comercial-cliente.js (e qualquer outro conteúdo futuro condicionado a
  // "forte + noite") nunca seria varrido pela guarda.
  estadoBase({
    identidade: { nivel: 'forte', origem: 'phone', primeiroNome: '[nome]', contracts: [{ id: 1 }], contestado: false },
    contratos: [{ id: 1, plano: '[plano]', velocidade: null, endereco: '[endereço]', status: 'ativo' }],
    triagem: { noturno: { ativo: true, retornoAs: '[hora]' }, forcarConclusao: false },
  }),
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
// Rodada de correção (Task 16, dono, 2026-09-18): terceira ocorrência do
// mesmo escape — comercial-novo.js (Task 14) já tinha trocado o cabeçalho
// "COMERCIAL" por "VENDA", suporte-diagnostico.js (Task 15) já tinha trocado
// "SUPORTE — RELATO DE FALHA" por "RELATO DE FALHA", e agora reativacao.js
// ia repetir o mesmo erro com "REATIVAÇÃO:" como rótulo. Nas três vezes a
// causa é a mesma: o regex de "nome de setor" é case-sensitive e só pega a
// forma "Palavra" (P maiúsculo, resto minúsculo) — um RÓTULO em CAIXA ALTA
// (como o próprio ai-orchestrator.js usa para títulos de seção) passa reto.
// Categoria nova, formalizada aqui em vez de esperar uma quarta tarefa
// redescobrir: um padrão SEPARADO para a forma toda maiúscula, ANCORADO NO
// INÍCIO da entrada (^) — porque é exatamente aí que o defeito real mora: um
// bullet/bloco que ABRE nomeando o setor como se fosse o título da seção.
// Testado por mutação (achado real, não hipotético): a primeira versão deste
// padrão, sem o ^, reprovou fatos.js linha 103 — "...dizer o status do
// contrato e da conexão no fluxo de SUPORTE abaixo" — uma referência cruzada
// NO MEIO da frase (não um rótulo), migração da Task 12, revisada, verbatim
// do original (ai-orchestrator.js:412). Ancorar no início resolve o achado
// sem tocar em fatos.js (fora do escopo desta tarefa) porque o defeito real
// (rótulo) sempre ocupa o começo do bullet — os três casos precedentes
// (COMERCIAL, SUPORTE —, REATIVAÇÃO:) começavam a própria entrada do array,
// e é isso que ^ verifica.
// Por que NÃO adicionar a flag /i no padrão já existente em vez de um
// padrão novo: isso reprovaria a própria convenção que a Restrição Global
// exige — "o setor da lista acima que cuidar de suporte/vendas/financeiro"
// (minúsculo, function-word, não nome próprio) é texto SANCIONADO, usado em
// dezenas de linhas já revisadas; case-insensitive pegaria todas elas.
//
// Rodada de correção 1 (revisão do coordenador, 2026-09-18): buraco latente
// no padrão de CAIXA ALTA acima. Cada elemento de linhas() é UMA STRING, mas
// pode ser um bloco de VÁRIAS sentenças juntadas com .join('\n') (ex.: o
// ramo triageResolvedReasonId de financeiro.js, ou o bloco "- Contrato ativo
// e conexão online" de suporte-diagnostico.js). O `^` sem a flag /m ancora
// no início da STRING INTEIRA do elemento — só pegaria um rótulo em caixa
// alta se ele fosse a PRIMEIRA sentença do bloco. Um rótulo como SEGUNDA ou
// TERCEIRA sentença de um `.join('\n')` passaria batido. Não havia caso
// ativo ainda, mas a Task 17 migra o bloco do modo noturno (o mais longo do
// prompt antigo, com essa forma de várias sentenças juntadas) — bug latente
// virando ativo na próxima tarefa se não corrigido agora.
// Fix: a varredura agora quebra CADA elemento por '\n' e testa TODA regra
// linha a linha (não só a de CAIXA ALTA — as outras não mudam de resultado
// com isso, já que nenhuma delas usa ^/$, mas testar a sub-linha em vez do
// bloco inteiro também deixa a MENSAGEM DE ERRO apontar a frase exata, não o
// parágrafo inteiro — preferido a só acrescentar /m pelo mesmo motivo).
// Verificado por mutação (ver relatório da Task 16, Rodada de correção 1):
// rótulo em caixa alta injetado como SEGUNDA sentença de um elemento
// .join('\n') de financeiro.js — pego; revertido.
const NOME_DOS_REGEX = [
  ['velocidade', /\d+\s*mega/i],
  ['preço', /R\$\s*\d/],
  ['nome de setor', /\b(Financeiro|Comercial|Suporte|Reativação)\b/],
  ['nome de setor em CAIXA ALTA (rótulo no início da linha)', /^(FINANCEIRO|COMERCIAL|SUPORTE|REATIVAÇÃO)\b/],
  ['oferta da operação', /fibra|óptica|grátis|gratuit|ilimitad/i],
];

test('nenhum módulo (exceto painel, que repassa dado do operador) hardcoda velocidade, preço ou nome de setor', () => {
  const violacoes = [];
  for (const modulo of MODULOS) {
    if (modulo.nome === 'painel') continue;
    for (const estado of ESTADOS_PARA_VARREDURA) {
      if (!modulo.entra(estado)) continue;
      modulo.linhas(estado).forEach((linha, indice) => {
        // Cada elemento pode ser um bloco de várias sentenças juntadas com
        // .join('\n') (ver Rodada de correção 1 acima) — quebrar por '\n' e
        // testar cada física linha separadamente é o que faz `^` (sem /m)
        // enxergar o início de CADA sentença do bloco, não só do elemento
        // inteiro, e também é o que deixa a mensagem de erro abaixo apontar
        // a frase exata em vez do parágrafo inteiro.
        linha.split('\n').forEach((subLinha) => {
          for (const [rotulo, regex] of NOME_DOS_REGEX) {
            if (regex.test(subLinha)) {
              violacoes.push(`módulo "${modulo.nome}", linha [${indice}] — ${rotulo} hardcoded: "${subLinha}"`);
            }
          }
        });
      });
    }
  }
  expect(violacoes).toEqual([]);
});

// Rodada de correção 3 (Task 17): a correção mais estrutural da rodada 1
// (quatro entra() passando a excluir identidade.sgpIndisponivel, em
// suporte-diagnostico.js, financeiro.js, reativacao.js e
// comercial-cliente.js) só era testada módulo a módulo — nenhuma asserção
// cobria o PROMPT MONTADO nesse estado. Sem esta guarda, basta um módulo
// futuro entrar nesse estado com instrução de ferramenta dependente do SGP
// para a contradição com fatos.js (que manda "NÃO tente boleto, PIX nem
// status de conexão" quando o SGP está indisponível) voltar sem nenhum
// teste vermelho — foi exatamente assim que ela surgiu da primeira vez
// (Task 16, item 2 do relatório, registrada mas não corrigida por falta de
// autorização até a Task 17).
test('com SGP indisponível, o prompt montado não instrui nenhuma ferramenta que dependa do SGP', () => {
  const texto = montarContexto(estadoBase({
    identidade: { nivel: 'forte', origem: 'memory', primeiroNome: '[nome]', contracts: [], contestado: false, sgpIndisponivel: true },
  }));
  expect(texto).not.toMatch(/consultar_status_todos_contratos/);
  expect(texto).not.toMatch(/enviar_boleto/);
  expect(texto).not.toMatch(/gerar_pix/);
});

// =====================================================================
// Task 18 — ajustes de ordem (painel logo após fatos, noturno antes dos
// fluxos operacionais) e fim da duplicação de estado em identificacao.js.
// Ver .superpowers/sdd/2026-09-17-ia-atendimento-humana/task-18-ajustes-brief.md
// =====================================================================
// Pedido explícito do dono: estes três testes são sobre o PROMPT RENDERIZADO
// (o texto final de montarContexto), não sobre a posição de um módulo dentro
// do array MODULOS — mover um módulo no array não prova que a referência
// textual que ele deveria preceder realmente aparece depois dele no texto
// montado.

const ESTADO_IDENTIFICADO = estadoBase({
  identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
  contratos: [{ id: 1, plano: 'X', velocidade: null, endereco: 'Rua A', status: 'ativo' }],
});

const ESTADO_IDENTIFICADO_NOTURNO = estadoBase({
  identidade: { nivel: 'forte', origem: 'phone', primeiroNome: 'João', contracts: [{ id: 1 }], contestado: false },
  contratos: [{ id: 1, plano: 'X', velocidade: null, endereco: 'Rua A', status: 'ativo' }],
  ferramentas: ['buscar_cliente', 'concluir_triagem', 'analisar_comprovante', 'desbloqueio_confianca'],
  triagem: { noturno: { ativo: true, retornoAs: '08:00' }, forcarConclusao: false },
});

test('a lista de setores (painel) aparece antes das referências "setor da lista acima", nos estados não identificado, identificado e noturno', () => {
  const estados = [estadoBase(), ESTADO_IDENTIFICADO, ESTADO_IDENTIFICADO_NOTURNO];
  for (const estado of estados) {
    const texto = montarContexto(estado);
    const idxSetores = texto.indexOf('Setores (use o id exato');
    expect(idxSetores).toBeGreaterThanOrEqual(0);

    const ocorrencias = [...texto.matchAll(/setor da lista acima/g)].map((m) => m.index);
    // Guarda equivalente ao "indexOf >= 0" pedido pelo brief: matchAll só
    // devolve casamentos reais (nunca -1), então a guarda aqui é garantir que
    // a varredura achou mais de uma ocorrência — senão as asserções abaixo
    // passariam vazias.
    expect(ocorrencias.length).toBeGreaterThan(1);

    // NENHUMA referência posicional pode vir antes da lista. A frase "acima"
    // só é verdade se o referente já foi lido: o prompt é lido de cima para
    // baixo, e uma referência para frente rotulada "acima" manda o modelo
    // procurar no lugar errado. fatos.js era a última exceção (é o único
    // módulo antes de painel) e foi reescrito sem a palavra posicional.
    const antesDaLista = ocorrencias.filter((i) => i < idxSetores);
    expect(antesDaLista).toEqual([]);
  }
});

test('com o modo noturno ativo, "MODO NOTURNO" aparece antes dos roteiros que ele governa (suporte, financeiro e comprovante)', () => {
  const texto = montarContexto(ESTADO_IDENTIFICADO_NOTURNO);
  const idxNoturno = texto.indexOf('MODO NOTURNO');
  expect(idxNoturno).toBeGreaterThanOrEqual(0);

  // suporte-diagnostico: é o módulo que noturno.js referencia diretamente
  // ("CONEXÃO À NOITE: os roteiros de suporte (consulte
  // consultar_status_todos_contratos antes)") — só suporte-diagnostico.js
  // chama essa ferramenta.
  const idxSuporte = texto.indexOf('RELATO DE FALHA (internet lenta');
  const idxFinanceiro = texto.indexOf('PEDIDO DE PAGAMENTO (');
  const idxComprovante = texto.indexOf('COMPROVANTE À NOITE');
  expect(idxSuporte).toBeGreaterThanOrEqual(0);
  expect(idxFinanceiro).toBeGreaterThanOrEqual(0);
  expect(idxComprovante).toBeGreaterThanOrEqual(0);

  expect(idxNoturno).toBeLessThan(idxSuporte);
  expect(idxNoturno).toBeLessThan(idxFinanceiro);
  expect(idxNoturno).toBeLessThan(idxComprovante);
});

test('"Cliente NÃO identificado." aparece exatamente uma vez no prompt do estado não identificado', () => {
  const texto = montarContexto(estadoBase());
  const ocorrencias = texto.match(/Cliente NÃO identificado\./g) || [];
  expect(ocorrencias.length).toBe(1);
});

// =====================================================================
// Task 20, rodada de correção 1 — a lacuna de COMPOSIÇÃO do fluxo de terceiro
// =====================================================================
// Achado da execução real com a OpenAI (2026-09-18, roteiros 14 e 17): a
// instrução "NÃO conclua a triagem nesse momento" existia só em
// fluxos/financeiro.js, cujo entra() exige identidade forte. No fluxo de
// boleto de terceiro quem pede NUNCA é identificado (titularEOutraPessoa
// preenche contexto.terceiro, não contexto.contracts — decisão de segurança
// da Fase 2), então o módulo inteiro ficava fora e a instrução nunca chegava
// ao modelo: ele entregou o boleto do titular e concluiu a triagem no mesmo
// turno.
// Este teste é sobre o PROMPT MONTADO no estado exato onde a linha faltava —
// testar só terceiros.linhas() provaria que o texto existe, não que ele chega
// ao modelo neste estado.
const ESTADO_TERCEIRO_COM_MOTIVO = estadoBase({
  terceiro: { titular: '[nome do titular]' },
  config: { systemPrompt: 'p', triageExtraInstructions: null, triageResolvedReasonId: '[motivo]' },
});

test('no estado de terceiro (identidade none) o prompt montado manda NÃO concluir a triagem depois de entregar', () => {
  // A condição que CRIOU a lacuna continua valendo: o financeiro segue fora.
  // Se um dia alguém afrouxar esse entra(), este expect vira vermelho e quem
  // mexer tem de decidir de novo, em vez de a mudança passar despercebida.
  const financeiro = MODULOS.find((m) => m.nome === 'financeiro');
  expect(financeiro.entra(ESTADO_TERCEIRO_COM_MOTIVO)).toBe(false);

  const texto = montarContexto(ESTADO_TERCEIRO_COM_MOTIVO);
  expect(texto).toContain('NÃO conclua a triagem nesse momento');
  expect(texto).toMatch(/chame encerrar_atendimento/);
});

test('sem motivo de encerramento configurado, o prompt de terceiro não traz a instrução de não concluir', () => {
  const texto = montarContexto(estadoBase({ terceiro: { titular: '[nome do titular]' } }));
  expect(texto).not.toContain('NÃO conclua a triagem nesse momento');
});

// Coerencia da COMPOSICAO, nao de um modulo isolado. O defeito de 2026-09-22
// nao estava em nenhum modulo sozinho: estava no prompt montado, onde painel
// mandava consultar a ferramenta e comercial-novo mandava copiar o texto.
describe('fontes comerciais na composicao final', () => {
  const COM = ['buscar_cliente', 'concluir_triagem', 'consultar_planos', 'verificar_cobertura'];
  const SEM = ['buscar_cliente', 'concluir_triagem'];
  const INSTRUCOES_ANTIGAS = 'PLANOS\n500 Mega — R$ 80/mês\n600 Mega — R$ 95/mês';

  function prompt(ferramentas, extra = {}) {
    return montarContexto(estadoBase({ ferramentas, ...extra }));
  }

  test('com as ferramentas, nenhuma ordem manda usar SOMENTE as instrucoes para plano ou cobertura', () => {
    const t = prompt(COM, { config: { ...estadoBase().config, triageExtraInstructions: INSTRUCOES_ANTIGAS } });

    expect(t).not.toMatch(/copie o bloco de planos/);
    expect(t).not.toMatch(/Preço, planos e cobertura: informe SOMENTE/);
    expect(t).not.toMatch(/mandam em preço, planos, cobertura e política comercial/);
  });

  test('com tabela antiga conflitante nas instrucoes, a ordem e consultar e a ferramenta prevalece', () => {
    const t = prompt(COM, { config: { ...estadoBase().config, triageExtraInstructions: INSTRUCOES_ANTIGAS } });

    // O texto salvo continua saindo inteiro: nao apagamos configuracao.
    expect(t).toContain(INSTRUCOES_ANTIGAS);
    expect(t).toMatch(/chame consultar_planos/);
    expect(t).toMatch(/prevalece/i);
  });

  test('instrucoes vazias nao impedem o uso das ferramentas', () => {
    const t = prompt(COM, { config: { ...estadoBase().config, triageExtraInstructions: null } });

    expect(t).not.toMatch(/você não tem como confirmar sozinha/);
    expect(t).toMatch(/chame consultar_planos/);
    expect(t).toMatch(/verificar_cobertura/);
  });

  test('sem ferramenta nenhuma, o prompt antigo sai inteiro e nada manda chamar', () => {
    const t = prompt(SEM, { config: { ...estadoBase().config, triageExtraInstructions: INSTRUCOES_ANTIGAS } });

    expect(t).not.toMatch(/chame consultar_planos/);
    expect(t).not.toMatch(/chame verificar_cobertura/);
    expect(t).toMatch(/Preço, planos e cobertura: informe SOMENTE o que estiver escrito nas INSTRUÇÕES/);
    expect(t).toMatch(/mandam em preço, planos, cobertura e política comercial/);
  });

  test('disponibilidade e por ferramenta: so planos nao manda chamar cobertura', () => {
    const t = prompt(['buscar_cliente', 'consultar_planos']);

    expect(t).toMatch(/chame consultar_planos/);
    expect(t).not.toMatch(/chame verificar_cobertura/);
    // O caminho antigo de cobertura continua.
    expect(t).toMatch(/se a cidade estiver nas instruções/);
  });

  test('disponibilidade e por ferramenta: so cobertura nao manda chamar planos', () => {
    const t = prompt(['buscar_cliente', 'verificar_cobertura']);

    expect(t).toMatch(/chame verificar_cobertura/);
    expect(t).not.toMatch(/chame consultar_planos/);
    expect(t).toMatch(/copie o bloco de planos/);
  });

  test('o SGP continua sendo a fonte do plano CONTRATADO e do financeiro', () => {
    const t = prompt(COM, {
      identidade: { nivel: 'forte', origem: 'cpf', primeiroNome: 'Ana', contracts: [], contestado: false, sgpIndisponivel: false },
      contratos: [{ id: 1, plano: 'Plano do contrato', velocidade: '500 Mbps', endereco: 'Rua X', status: 'Ativo' }],
    });

    // A linha de contrato (SGP) nao foi trocada por ferramenta comercial.
    expect(t).toMatch(/contrato 1 — Plano do contrato/);
    expect(t).toMatch(/NUNCA diga ao cliente: valores e vencimentos de faturas/);
  });

  test('o caminho de suporte nao foi reescrito', () => {
    const t = prompt(COM);

    expect(t).toMatch(/DÚVIDA não é falha/);
    expect(t).toMatch(/ALCANCE DO WI-FI/);
    expect(t).toMatch(/prazo, política, equipamento fornecido/);
  });
});
