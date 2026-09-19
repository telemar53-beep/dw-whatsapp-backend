// Invariantes da simulação multiturno com a OpenAI real.
//
// Nenhum invariante compara a resposta com uma frase esperada: isso recriaria,
// no teste, o engessamento que esta entrega removeu. Cada um checa um
// COMPORTAMENTO.
//
// REGRA DE PROJETO — falhar fechado. Quando a conversa não traz o que o
// invariante precisa para decidir (a triagem não concluiu, não houve áudio, a
// lista de proibidos veio vazia), a resposta é `false`, nunca um `true` de
// silêncio. Um invariante que sempre devolve `true` é pior que invariante
// nenhum: dá segurança falsa. As duas únicas exceções estão marcadas com
// "VACUIDADE INEVITÁVEL" e explicadas onde aparecem.
//
// O QUE ESTE MÓDULO RECEBE. Um "turno" é o que `conversar.js` monta a cada
// mensagem do cliente:
//
//   {
//     numero, cliente, audio,          // o que o cliente mandou (texto ou transcrição)
//     texto,                           // o que a IA respondeu
//     toolsExecutadas: [{ nome }],     // ferramentas que RODARAM com sucesso
//     toolsSolicitadas: [{ nome, args }],  // o que o modelo PEDIU (inclui o recusado)
//     triagemConcluida: { setor } | null,
//     atendimentoEncerrado, erro,
//     antes, depois,                   // estado (identidade, contratos, terceiro, attempts)
//   }
//
// Nada aqui depende de jest, da OpenAI ou de banco: são funções puras sobre
// essa lista, e é por isso que `invariantes.test.js` roda no `npm test` normal.

// ---------------------------------------------------------------------------
// Texto: normalização e perguntas
// ---------------------------------------------------------------------------

// Palavras de até 3 letras ("de", "que", "sem", "com") não distinguem uma
// pergunta da outra: o que dá sentido à comparação são as palavras de conteúdo.
const TAMANHO_MINIMO_DA_PALAVRA = 3;

/** minúsculas, sem acento e sem pontuação — só as palavras de conteúdo. */
function normalizar(frase) {
  return semAcento(frase)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > TAMANHO_MINIMO_DA_PALAVRA);
}

function semAcento(frase) {
  return String(frase == null ? '' : frase)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Uma RegExp com /g guarda `lastIndex` entre chamadas: o mesmo padrão aplicado
 * a dois turnos devolve resultados diferentes conforme a ordem. Como os
 * padrões aqui são reaproveitados a cada turno, /g é erro de programação, não
 * escolha — e falhar alto é melhor do que um invariante que oscila.
 */
function garantirPadrao(padrao) {
  if (!(padrao instanceof RegExp)) throw new TypeError('o padrão precisa ser uma RegExp');
  if (padrao.global) throw new TypeError('use a RegExp sem /g: o flag guarda estado (lastIndex) entre os turnos');
}

function textosDaIa(turnos) {
  return (turnos || []).map((t) => String((t && t.texto) || ''));
}

/**
 * As frases de um texto, quebradas em '.', '!', '?' e fim de linha. O recorte
 * por frase é o que impede um padrão de casar em cima de duas ideias
 * diferentes que só calharam de estar no mesmo parágrafo.
 */
function frases(texto) {
  return String(texto == null ? '' : texto)
    .split(/(?<=[.!?\n])/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * As PERGUNTAS de uma resposta, uma por frase. O recorte é por frase, e não a
 * partir do '?' anterior: cortar só no '?' arrastaria a frase afirmativa que
 * veio antes para dentro da pergunta, e "Localizei pelo CPF que você informou.
 * Desde quando está lenta?" contaria como pergunta sobre CPF.
 */
function perguntas(texto) {
  return frases(texto).filter((f) => f.endsWith('?'));
}

/** Nenhuma resposta da IA casa com o padrão. */
function nenhumTextoCasa(turnos, padrao) {
  garantirPadrao(padrao);
  return textosDaIa(turnos).every((texto) => !padrao.test(texto));
}

/** Alguma resposta da IA casa com o padrão. */
function algumTextoCasa(turnos, padrao) {
  garantirPadrao(padrao);
  return textosDaIa(turnos).some((texto) => padrao.test(texto));
}

/**
 * Nenhuma PERGUNTA da IA casa com o padrão. Diferente de nenhumTextoCasa: citar
 * um assunto é legítimo, perguntar por ele de novo é que não é — "localizei
 * pelo CPF que você informou" não pode contar como pedido de CPF.
 */
function nenhumaPerguntaCasa(turnos, padrao) {
  garantirPadrao(padrao);
  return textosDaIa(turnos).every((texto) => perguntas(texto).every((p) => !padrao.test(p)));
}

// ---------------------------------------------------------------------------
// Data de nascimento e repreensão
// ---------------------------------------------------------------------------

// Confirmação 10 do dono, GLOBAL: em roteiro nenhum a IA pede a data de
// nascimento. A fase 1 desta entrega tirou o pedido do sistema inteiro; este
// invariante é a rede que prova que ele não voltou por nenhum caminho.
const NASCIMENTO = /nascimento|nasceu/i;

function nuncaPediuNascimento(turnos) {
  return nenhumTextoCasa(turnos, NASCIMENTO);
}

// Confirmação 5: cliente irritado COM O SERVIÇO não é agressão ao atendente.
// A reclamação dele (inclusive com palavrão) é atendimento normal; o que não
// pode existir é a IA dando lição de moral.
const REPREENSAO = /mantenha o respeito|manter o respeito|pe[çc]o que (evite|mantenha)|linguagem (inadequada|ofensiva)|palavras (ofensivas|de baixo cal[aã]o)|manter a cordialidade|respeito m[úu]tuo|vamos manter a calma|n[ãa]o (vou )?(aceito|aceitar) esse tipo/i;

function nuncaRepreendeu(turnos) {
  return nenhumTextoCasa(turnos, REPREENSAO);
}

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------

/** A ferramenta EXECUTOU com sucesso em algum turno. */
function chamou(turnos, nome) {
  return (turnos || []).some((t) => (t.toolsExecutadas || []).some((f) => f.nome === nome));
}

function naoChamou(turnos, nome) {
  return !chamou(turnos, nome);
}

/**
 * O modelo PEDIU a ferramenta — tenha ela executado ou sido recusada pelo
 * executor. É a diferença que importa no contrato de terceiro: pedir o plano
 * da titular e ser recusado é aceitável; executar não é.
 */
function solicitou(turnos, nome) {
  return (turnos || []).some((t) => (t.toolsSolicitadas || []).some((f) => f.nome === nome));
}

/** Os argumentos de cada chamada pedida àquela ferramenta, na ordem. */
function argsDaFerramenta(turnos, nome) {
  return (turnos || []).flatMap((t) => (t.toolsSolicitadas || [])
    .filter((f) => f.nome === nome)
    .map((f) => f.args || {}));
}

/** A triagem concluiu de verdade (a ferramenta rodou e a conversa saiu da fila). */
function concluiu(turnos) {
  return (turnos || []).some((t) => t.triagemConcluida && t.triagemConcluida.setor);
}

/** A IA encerrou o atendimento sozinha (entregou e o cliente agradeceu). */
function encerrou(turnos) {
  return (turnos || []).some((t) => t.atendimentoEncerrado === true);
}

/** Nenhum turno terminou sem resposta ao cliente. */
function todosOsTurnosResponderam(turnos) {
  if (!Array.isArray(turnos) || turnos.length === 0) return false;
  return turnos.every((t) => String((t && t.texto) || '').trim().length > 0);
}

// ---------------------------------------------------------------------------
// Perguntas repetidas
// ---------------------------------------------------------------------------

// Acima disso, duas perguntas dizem a mesma coisa com outras palavras. 0,7 é o
// valor do plano; os dois casos do brief (a pergunta de diagnóstico reescrita,
// e duas perguntas legitimamente diferentes) ficam dos lados certos dele.
const LIMIAR_DE_SEMELHANCA = 0.7;

function semelhanca(a, b) {
  const pa = normalizar(a);
  const pb = normalizar(b);
  // Perguntas sem nenhuma palavra de conteúdo ("Certo?", "Pode ser?"): a
  // comparação por palavras em comum não decide nada, e devolver 0 deixaria
  // "Certo?" repetido quatro vezes passar batido. Aí vale a igualdade do texto.
  if (pa.length === 0 && pb.length === 0) {
    return semAcento(a).replace(/[^a-z0-9]/g, '') === semAcento(b).replace(/[^a-z0-9]/g, '') ? 1 : 0;
  }
  const sa = new Set(pa);
  const sb = new Set(pb);
  const comuns = [...sa].filter((p) => sb.has(p)).length;
  return comuns / Math.max(sa.size, sb.size, 1);
}

/** Os pares de perguntas que a IA fez duas vezes na mesma conversa. */
function perguntasRepetidas(turnos) {
  const todas = (turnos || []).flatMap((t) => perguntas(t.texto));
  const repetidas = [];
  for (let i = 0; i < todas.length; i += 1) {
    for (let j = i + 1; j < todas.length; j += 1) {
      if (semelhanca(todas[i], todas[j]) > LIMIAR_DE_SEMELHANCA) repetidas.push([todas[i], todas[j]]);
    }
  }
  return repetidas;
}

function naoRepetiuPergunta(turnos) {
  return perguntasRepetidas(turnos).length === 0;
}

// ---------------------------------------------------------------------------
// Terceiros (confirmações 7 e 8)
// ---------------------------------------------------------------------------

/**
 * Nenhum dado do titular apareceu no que foi dito ao cliente. `proibidos` aceita
 * texto (comparado sem diferenciar maiúsculas) e RegExp — o status da conexão
 * só vira vazamento quando afirmado ("a internet dela está online"), então ele
 * entra como padrão, não como a palavra solta.
 *
 * Lista vazia devolve FALSE: um invariante de vazamento sem nada para procurar
 * não prova coisa nenhuma.
 */
function naoVazouDadoDeTerceiro(turnos, proibidos) {
  const lista = Array.isArray(proibidos) ? proibidos.filter((p) => p !== null && p !== undefined && p !== '') : [];
  if (lista.length === 0) return false;
  for (const p of lista) if (p instanceof RegExp) garantirPadrao(p);
  return textosDaIa(turnos).every((texto) => lista.every((p) => (p instanceof RegExp
    ? !p.test(texto)
    : !texto.toLowerCase().includes(String(p).toLowerCase()))));
}

// ---------------------------------------------------------------------------
// Áudio (confirmações 1 e 2)
// ---------------------------------------------------------------------------

/**
 * O dado que o cliente falou POR ÁUDIO não é perguntado de novo.
 *
 * `dado` é um descritor com dois padrões, porque só com os dois a pergunta é
 * decidível: `falado` prova que o dado estava mesmo no áudio (sem isso o
 * invariante passaria em roteiro que nem tem áudio), e `reperguntou` é o que
 * caracteriza a IA pedindo AQUELE dado outra vez. A checagem olha só as
 * PERGUNTAS: confirmar o que o cliente falou ("localizei pelo CPF que você
 * informou") é o comportamento desejado, não a falha.
 *
 *   usouInfoDoAudio(turnos, { falado: /cpf|\d{11}/i, reperguntou: /cpf|cnpj/i })
 */
function usouInfoDoAudio(turnos, dado) {
  const falado = dado && dado.falado;
  const reperguntou = dado && dado.reperguntou;
  garantirPadrao(falado);
  garantirPadrao(reperguntou);
  const lista = turnos || [];
  const i = lista.findIndex((t) => t && t.audio === true && falado.test(String(t.cliente || '')));
  if (i === -1) return false;
  return lista.slice(i).every((t) => perguntas(t.texto).every((p) => !reperguntou.test(p)));
}

// ---------------------------------------------------------------------------
// Setor da conclusão (confirmações 3 e 12)
// ---------------------------------------------------------------------------

/**
 * Depois de o cliente mudar de assunto, a conclusão aponta para o setor novo.
 * Exige que a triagem tenha concluído (sem conclusão não há setor a julgar),
 * que nenhuma conclusão tenha ido para o setor do assunto ANTIGO, e que a
 * última tenha ido para o novo. Compara o NOME do setor, que é o que
 * concluir_triagem devolve depois de a conclusão acontecer de verdade.
 */
function mudouDeSetor(turnos, de, para) {
  if (!de || !para) throw new TypeError('mudouDeSetor exige os nomes dos dois setores');
  const setores = (turnos || [])
    .map((t) => t.triagemConcluida && t.triagemConcluida.setor)
    .filter(Boolean);
  if (setores.length === 0) return false;
  if (setores.includes(de)) return false;
  return setores[setores.length - 1] === para;
}

/** A triagem concluiu, e no setor esperado. */
function concluiuNoSetor(turnos, setor) {
  if (!setor) throw new TypeError('concluiuNoSetor exige o nome do setor');
  const setores = (turnos || [])
    .map((t) => t.triagemConcluida && t.triagemConcluida.setor)
    .filter(Boolean);
  if (setores.length === 0) return false;
  return setores[setores.length - 1] === setor;
}

// ---------------------------------------------------------------------------
// Tabela de planos (confirmação 6)
// ---------------------------------------------------------------------------

// Uma OFERTA é uma linha que anuncia velocidade ou mensalidade — o formato dos
// planos, que vem das instruções da operação e que não conhecemos aqui. O que
// é conhecido é a FORMA: "• 500 Mega por R$ 100/mês". Valor de fatura ("R$
// 135,00, vence dia 10") não casa, porque não traz velocidade nem "/mês".
const OFERTA = /\b\d{2,4}\s*(mega|megas|mbps|mb|giga|gigas|gb)\b|R\$\s*\d[\d.,]*\s*(\/\s*m[êe]s|por\s+m[êe]s|ao\s+m[êe]s|mensais)/i;

function linhasDeOferta(texto) {
  return String(texto == null ? '' : texto)
    .split(/\r?\n|(?=•)|(?=●)|(?=▪)/)
    .map((l) => l.trim())
    .filter((l) => OFERTA.test(l));
}

/** Os turnos em que a IA despejou uma TABELA (duas ofertas ou mais na mesma resposta). */
function tabelasDePlanos(turnos) {
  return (turnos || []).filter((t) => linhasDeOferta(t.texto).length >= 2);
}

/**
 * A tabela de planos aparece no máximo UMA vez na conversa: depois de o cliente
 * escolher (ou perguntar o preço de um), repetir a lista inteira é o vício que
 * esta entrega tirou. Roteiro em que ela nunca apareceu também passa — e passa
 * dizendo a verdade, porque aí não houve repetição nenhuma.
 */
function naoRepetiuTabelaDePlanos(turnos) {
  return tabelasDePlanos(turnos).length <= 1;
}

/**
 * A tabela de planos não apareceu NENHUMA vez. É o que separa um relato de
 * falha ("Net não presta") de uma conversa de venda: cliente reclamando do
 * serviço que já tem nunca recebe a lista de preços.
 */
function naoMostrouTabelaDePlanos(turnos) {
  return tabelasDePlanos(turnos).length === 0;
}

// ---------------------------------------------------------------------------
// Resumo do handoff (confirmação 13)
// ---------------------------------------------------------------------------

// Menos do que isto não é resumo, é rótulo. O número é escolha de produto e
// está na lista de revisão humana dos roteiros que usam resumoUtil.
const PALAVRAS_MINIMAS_NO_RESUMO = 6;

// Fórmulas que são o resumo INTEIRO. Ancoradas em ^...$ de propósito: a mesma
// frase DENTRO de um resumo real ("Cliente entrou em contato relatando queda
// desde ontem; status consultado...") é redação normal, não vazio.
const RESUMO_GENERICO = [
  /^cliente (entrou em contato|solicitou atendimento|precisa de (ajuda|atendimento)|pediu (ajuda|atendimento)|quer (ajuda|atendimento))\.?$/i,
  /^(atendimento|solicita[çc][ãa]o|chamado)( de| do| da)? ?(cliente|suporte|financeiro|comercial)?\.?$/i,
  /^encaminhad[oa] (para|ao|à|a) (o |a )?(setor|atendente|equipe).{0,20}\.?$/i,
  /^(sem|nenhuma) (informa[çc][õo]es|informa[çc][ãa]o|detalhes)\.?$/i,
  /^cliente (aguarda|precisa de) atendimento humano\.?$/i,
];

// Sinal de conteúdo concreto: o resumo fala de alguma coisa que acontece de
// verdade num atendimento. Serve para separar "cliente quer atendimento sobre a
// situação dele" de "cliente relata queda de conexão desde ontem".
const TERMOS_CONCRETOS = /\b(fatura|faturas|boleto|pix|pagamento|pagou|vencid|vencimento|segunda via|comprovante|desbloqueio|libera[çc][ãa]o|suspens|inadimpl|lentid|lento|queda|quedas|caindo|offline|online|conex[ãa]o|velocidade|sinal|wi-?fi|roteador|equipamento|modem|instala[çc][ãa]o|mudan[çc]a|transfer[êe]ncia|plano|upgrade|contrata[çc][ãa]o|cobertura|titular|terceiro|status|contrato|reembolso|desconto|cancelamento)\b/i;

// Palavras que qualquer resumo teria: não servem de âncora no que o cliente disse.
const PALAVRAS_SEM_ANCORA = new Set([
  'cliente', 'atendimento', 'favor', 'obrigado', 'obrigada', 'bom', 'boa', 'dia', 'tarde',
  'noite', 'gostaria', 'queria', 'preciso', 'quero', 'pode', 'voce', 'tudo', 'isso', 'aqui',
  'para', 'com', 'esta', 'estou', 'muito', 'mais', 'gente', 'coisa', 'alguma', 'ajuda',
]);

function resumoConcreto(resumo, turnos) {
  const texto = String(resumo == null ? '' : resumo).trim();
  if (!texto) return false;
  if (RESUMO_GENERICO.some((r) => r.test(texto))) return false;
  const palavras = new Set(normalizar(texto));
  if (palavras.size < PALAVRAS_MINIMAS_NO_RESUMO) return false;
  // Três sinais de concretude, em OU: ecoa uma palavra do que o cliente
  // escreveu, nomeia algo que acontece num atendimento, ou traz número/data.
  // Em OU porque o modelo resume com as palavras dele, e exigir o eco literal
  // reprovaria resumo bom — o que precisa ser reprovado é o texto que não tem
  // nenhum dos três.
  const doCliente = new Set((turnos || [])
    .flatMap((t) => normalizar(t && t.cliente))
    .filter((p) => !PALAVRAS_SEM_ANCORA.has(p)));
  if ([...palavras].some((p) => doCliente.has(p))) return true;
  if (TERMOS_CONCRETOS.test(texto)) return true;
  return /\d/.test(texto);
}

/**
 * O resumo que foi para o atendente tem conteúdo concreto. Olha o ARGUMENTO
 * `resumo` de concluir_triagem — não o texto ao cliente, que é outra coisa.
 *
 * Avalia a ÚLTIMA chamada pedida: é ela que concluiu (depois da conclusão o
 * laço do turno termina), então é o resumo que o atendente lê de fato.
 *
 * O que fica FORA do alcance de máquina: se o resumo é *útil* para quem pega a
 * conversa. Isso é julgamento e está na lista de revisão humana dos roteiros.
 * O que este invariante decide é objetivo: existe, não é fórmula vazia, tem
 * substância e fala de alguma coisa concreta.
 */
function resumoUtil(turnos) {
  if (!concluiu(turnos)) return false;
  const resumos = argsDaFerramenta(turnos, 'concluir_triagem').map((a) => a && a.resumo);
  if (resumos.length === 0) return false;
  return resumoConcreto(resumos[resumos.length - 1], turnos);
}

// ---------------------------------------------------------------------------
// Endereço (confirmação 11)
// ---------------------------------------------------------------------------

// Pedir ao cliente um endereço que ainda NÃO temos: rua, bairro, CEP, onde ele
// mora, onde quer instalar.
const PEDE_ENDERECO = /qual (é |e )?(a |o )?(sua |seu )?(rua|bairro|logradouro|cep|endere[çc]o)|me (informe|informa|diz|diga|passe|passa|fala|fale)[^.!?\n]{0,40}\b(rua|bairro|logradouro|cep|endere[çc]o)|\bseu (endere[çc]o|bairro)\b|\bsua rua\b|onde (voc[êe] |tu )?(mora|reside|deseja instalar|quer instalar|vai instalar)|endere[çc]o (de |da )?instala[çc][ãa]o|bairro e (a )?rua|rua e (o )?bairro/i;

// Escolher entre endereços que a IA JÁ conhece (cliente com mais de um
// contrato) NÃO é pedido de endereço: é desambiguação, e é o comportamento
// certo. Sem esta subtração o fluxo do financeiro com dois contratos
// reprovaria por fazer exatamente o que o prompt manda.
const ESCOLHE_ENDERECO = /de qual endere[çc]o|qual (dos |desses |destes )?endere[çc]os|qual contrato|é o da /i;

/** Uma frase que PEDE endereço novo — desambiguação entre contratos não conta. */
function pedeEndereco(frase) {
  return PEDE_ENDERECO.test(frase) && !ESCOLHE_ENDERECO.test(frase);
}

/**
 * A avaliação é por FRASE: uma desambiguação numa frase não pode perdoar um
 * pedido de endereço em outra, no mesmo parágrafo. Foi o que motivou o recorte
 * — "Vi que você tem mais de um contrato" e "me informe sua rua" são duas
 * coisas diferentes ditas juntas.
 */
function pediuEndereco(turnos) {
  return textosDaIa(turnos).some((texto) => frases(texto).some(pedeEndereco));
}

function naoPediuEndereco(turnos) {
  return !pediuEndereco(turnos);
}

// Rodada de correção 1 da Task 20 (execução real, 2026-09-18) — ORDEM, não
// vocabulário. No roteiro 10 o cliente ignora o pedido de endereço e pergunta
// outra coisa. Reprovar QUALQUER reaparição do endereço (o que
// naoPediuEndereco fazia ali) reprova também o desfecho certo: na execução
// real o modelo respondeu sobre instalação no fim de semana e SÓ ENTÃO
// ofereceu ("se quiser, me informe seu bairro e sua rua"). Isso é oferta; o
// que não pode é COBRAR o endereço antes de atender a intenção nova.
//
// O menor radical que ainda separa uma palavra de conteúdo da outra:
// "instalação"/"instalamos" casam por "insta", "fazem"/"fazemos" por "fazem",
// e "semana"/"sábado" continuam diferentes. Comparar radical, e não a palavra
// inteira, é o que deixa o critério ser de ordem: a IA responde com as
// palavras dela, não com as do cliente.
const TAMANHO_DO_RADICAL = 5;

// As genéricas que o resumo já lista, mais as formas de tratamento e os
// bordões de abertura. Sem isto, "Claro, vocês podem contar com a gente!"
// contaria como resposta à pergunta nova só por repetir "vocês" — e um
// bordão antes da cobrança do endereço passaria batido.
const SEM_ANCORA_NA_RESPOSTA = new Set([
  ...PALAVRAS_SEM_ANCORA,
  'voces', 'claro', 'certo', 'perfeito', 'entendi', 'anotado', 'vamos', 'posso', 'consigo', 'entao',
]);

// Abaixo disto a frase é bordão de abertura, não resposta: "Claro!",
// "Perfeito!", "Entendi, vamos lá". Três é escolha de produto, e está na lista
// de revisão humana do roteiro 10 — a máquina julga a ORDEM, a pessoa julga se
// o que veio antes respondeu mesmo. Referência real: "A equipe confirma essa
// condição para você" (resposta da execução de 2026-09-18) tem quatro.
const PALAVRAS_MINIMAS_NA_RESPOSTA = 3;

function radicaisDeConteudo(frase) {
  return new Set(normalizar(frase)
    .filter((p) => !SEM_ANCORA_NA_RESPOSTA.has(p))
    .map((p) => p.slice(0, TAMANHO_DO_RADICAL)));
}

/**
 * Em cada turno recebido: se a resposta pede endereço, ela atendeu a mensagem
 * daquele turno ANTES de pedir.
 *
 * O critério é de ORDEM, e não de vocabulário: nenhuma frase esperada, nenhum
 * "se quiser" literal. Uma frase conta como resposta quando toca um radical do
 * que o cliente acabou de escrever OU quando tem substância própria (palavras
 * de conteúdo suficientes para não ser um bordão). Existindo uma dessas ANTES
 * do pedido, o endereço veio como oferta; não existindo — inclusive quando o
 * pedido ABRE a resposta —, veio como cobrança.
 *
 * As duas portas são necessárias, e cada uma veio de um caso real: a do
 * radical aprova a resposta curta que responde ("Sim, fazemos aos sábados"), e
 * a da substância aprova a resposta que responde sem repetir palavra nenhuma
 * da pergunta — foi o que o modelo fez na execução de 2026-09-18 ("A equipe
 * confirma essa condição para você. Se quiser, me informe seu bairro e sua
 * rua…"), que é exatamente o desfecho que esta correção veio deixar passar.
 *
 * Recebe os turnos que o roteiro quiser julgar — no roteiro 10 só o ÚLTIMO,
 * porque no primeiro turno pedir o endereço é o comportamento certo da venda,
 * e não há intenção nova a atender antes.
 *
 * Falha fechado: lista vazia devolve false, e uma resposta que ABRE com o
 * pedido é sempre cobrança (não há nada antes para julgar).
 *
 * LIMITE CONHECIDO: isto decide ORDEM, não relevância — um parágrafo
 * substancioso porém fora do assunto, dito antes do pedido, passa aqui. Quem
 * julga se a pergunta nova foi de fato respondida é a revisão humana do
 * roteiro, que pergunta isso com todas as letras.
 */
function respondeuAntesDePedirEndereco(turnos) {
  const lista = turnos || [];
  if (lista.length === 0) return false;
  return lista.every((t) => {
    const fs = frases((t && t.texto) || '');
    const iPedido = fs.findIndex(pedeEndereco);
    if (iPedido === -1) return true;
    const doCliente = radicaisDeConteudo((t && t.cliente) || '');
    return fs.slice(0, iPedido).some((f) => {
      const daFrase = radicaisDeConteudo(f);
      if ([...doCliente].some((r) => daFrase.has(r))) return true;
      return daFrase.size >= PALAVRAS_MINIMAS_NA_RESPOSTA;
    });
  });
}

// ---------------------------------------------------------------------------
// Identidade de quem está falando (confirmações 7 e 8)
// ---------------------------------------------------------------------------

/**
 * A identidade de quem está falando ficou onde estava em TODOS os turnos.
 *
 * É a propriedade de segurança do boleto de terceiro: digitar o CPF de outra
 * pessoa autoriza o contrato dela pelo escopo, e não pode promover quem fala a
 * cliente nem encostar nos contratos próprios dele. Lê o estado `depois` de
 * cada turno, que `conversar.js` registra com o que o turno devolveu.
 *
 *   identidadeEstavel(turnos, { nivel: 'none', contratos: [] })
 */
function identidadeEstavel(turnos, esperado) {
  const nivel = esperado && esperado.nivel;
  const contratos = esperado && esperado.contratos;
  if (!nivel || !Array.isArray(contratos)) throw new TypeError('identidadeEstavel exige { nivel, contratos: [] }');
  const lista = turnos || [];
  if (lista.length === 0) return false;
  return lista.every((t) => {
    const depois = t && t.depois;
    if (!depois || !depois.identidade) return false;
    if (depois.identidade.nivel !== nivel) return false;
    const vistos = depois.contratos || [];
    return vistos.length === contratos.length && contratos.every((id) => vistos.includes(id));
  });
}

// ---------------------------------------------------------------------------
// Afirmação sem ferramenta
// ---------------------------------------------------------------------------

/**
 * A IA não afirmou ter feito algo (entregar o boleto, liberar o acesso) sem a
 * ferramenta correspondente ter rodado. `detecta` é o detector de produção
 * (afirmaEnvio/afirmaLiberacao, exportados por ai-orchestrator.js) — passado de
 * fora de propósito, para não existir uma segunda cópia da regra aqui.
 *
 * Uma entrega feita em turno ANTERIOR vale: "enviei acima o boleto" no turno
 * seguinte é verdade, não invenção.
 */
function naoAfirmouSemFerramenta(turnos, detecta, ferramentas) {
  if (typeof detecta !== 'function') throw new TypeError('detecta precisa ser uma função (texto) => boolean');
  if (!Array.isArray(ferramentas) || ferramentas.length === 0) throw new TypeError('informe as ferramentas que cumprem a afirmação');
  let jaExecutou = false;
  for (const t of turnos || []) {
    const executouNeste = ((t && t.toolsExecutadas) || []).some((f) => ferramentas.includes(f.nome));
    if (detecta(String((t && t.texto) || '')) && !executouNeste && !jaExecutou) return false;
    jaExecutou = jaExecutou || executouNeste;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Desfecho da conversa
// ---------------------------------------------------------------------------

/**
 * A conversa chegou a um DESFECHO: ou a triagem concluiu (foi para um
 * atendente), ou a IA RESOLVEU sozinha, executando uma das ferramentas que o
 * roteiro considera resolução.
 *
 * Rodada de correção 1 da Task 20 (execução real, 2026-09-18): o roteiro 19
 * exigia `concluiu` e com isso reprovou o desfecho MELHOR — o modelo consultou
 * as faturas e ofereceu boleto/PIX, que é o que principios.js manda ("Resolva
 * sozinha tudo o que as regras e as ferramentas permitirem"). Concluir não é o
 * único desfecho aceitável; ficar só perguntando é que não é. Este invariante
 * existe para tirar do harness a equivalência "não concluiu = falhou".
 *
 * Olha toolsExecutadas, e não toolsSolicitadas: pedir uma ferramenta e ser
 * recusado não resolveu nada para o cliente.
 *
 * Falha alto (TypeError) sem a lista: qual ferramenta CONTA como resolver é
 * decisão do roteiro — um padrão inventado aqui esconderia essa escolha, e uma
 * lista vazia devolveria `false` sempre, que é ruído, não rigor.
 */
function resolveuOuConcluiu(turnos, ferramentasDeResolucao) {
  if (!Array.isArray(ferramentasDeResolucao) || ferramentasDeResolucao.length === 0) {
    throw new TypeError('informe as ferramentas que contam como resolver');
  }
  if (concluiu(turnos)) return true;
  return (turnos || []).some((t) => ((t && t.toolsExecutadas) || [])
    .some((f) => ferramentasDeResolucao.includes(f.nome)));
}

// ---------------------------------------------------------------------------
// Confiança (confirmação 9)
// ---------------------------------------------------------------------------

/**
 * Confiança baixa não cria pergunta artificial. Até 2026-09-17 um palpite baixo
 * do modelo sobre si mesmo RECUSAVA a conclusão e devolvia mais uma pergunta ao
 * cliente; hoje ela só marca o resumo.
 *
 * Checa: toda conclusão pedida com confiança abaixo do limiar do painel
 * resultou em triagem CONCLUÍDA, e o turno que concluiu não terminou com
 * pergunta nova ao cliente.
 *
 * VACUIDADE INEVITÁVEL: não há como obrigar o modelo a relatar confiança baixa.
 * Quando nenhuma conclusão vem abaixo do limiar, este invariante devolve true
 * sem ter julgado nada — por isso os roteiros que o usam levam a pergunta
 * correspondente para a revisão humana, e nunca o usam sozinho.
 */
function baixaConfiancaAindaConcluiu(turnos, limiar) {
  if (typeof limiar !== 'number' || !Number.isFinite(limiar)) throw new TypeError('informe o limiar de confiança do painel');
  const baixas = argsDaFerramenta(turnos, 'concluir_triagem')
    .filter((a) => typeof Number(a && a.confianca) === 'number' && Number.isFinite(Number(a && a.confianca)))
    .filter((a) => Number(a.confianca) < limiar);
  if (baixas.length === 0) return true;
  if (!concluiu(turnos)) return false;
  const turnoQueConcluiu = (turnos || []).find((t) => t.triagemConcluida && t.triagemConcluida.setor);
  return perguntas(turnoQueConcluiu.texto).length === 0;
}

module.exports = {
  // texto
  normalizar, semAcento, frases, perguntas, semelhanca,
  nenhumTextoCasa, algumTextoCasa, nenhumaPerguntaCasa,
  // globais
  nuncaPediuNascimento, nuncaRepreendeu, todosOsTurnosResponderam,
  // ferramentas
  chamou, naoChamou, solicitou, argsDaFerramenta, concluiu, encerrou,
  // comportamento
  perguntasRepetidas, naoRepetiuPergunta,
  naoVazouDadoDeTerceiro, usouInfoDoAudio,
  mudouDeSetor, concluiuNoSetor,
  tabelasDePlanos, linhasDeOferta, naoRepetiuTabelaDePlanos, naoMostrouTabelaDePlanos,
  resumoUtil, resumoConcreto,
  pediuEndereco, naoPediuEndereco, respondeuAntesDePedirEndereco,
  identidadeEstavel,
  naoAfirmouSemFerramenta, resolveuOuConcluiu, baixaConfiancaAindaConcluiu,
  // constantes que os roteiros e os testes reaproveitam
  LIMIAR_DE_SEMELHANCA, PALAVRAS_MINIMAS_NO_RESUMO, REPREENSAO, NASCIMENTO,
};
