// Meios de pagamento comprovados pela 2ª via desta conversa (comportamento da IA, 06/10/2026; A6/A7). Puro.
//
// O estado de cada fatura — { contratoId, faturaId, pix, boleto } com true (existe), false (a 2ª via veio sem ele) ou null
// (não deu para saber: o pedido do PIX ao SGP falhou) — é gravado pelas ferramentas de cobrança (tool-registry.js), vai
// na metadata da resposta da IA (worker) e é herdado da resposta mais recente que o traz. Sem 2ª via, nada se sabe.
//
// As duas guardas da resposta usam SÓ esse estado — não interpretam o pedido do cliente nem ampliam o validador de
// promessas ("eu verifico" continua passando quando não é oferta de meio inexistente):
// 1. a frase que OFERECE um meio que a 2ª via mostrou inexistente (convite a pedir de novo, "posso enviar o boleto?",
//    "prefere boleto ou PIX?") sai, e entra o fato comprovado com o único próximo passo que existe;
// 2. a frase que AFIRMA a indisponibilidade de um meio sem resultado que a comprove (o pedido do PIX falhou, ou nenhuma
//    ferramenta respondeu e nada se sabe) sai, e entra que não deu para confirmar. Quando a ferramenta respondeu outra
//    coisa (bloqueio do gate, sem fatura, outro titular), a instrução dela vale e a guarda não age.
// O fato é da fatura E do contrato dela (ordem de 06/10/2026, tarde). Com mais de um contrato na conversa (os do cliente,
// os do terceiro confirmado e os que aparecem no estado), nenhuma frase é ligada a um contrato pelo texto — elipse, apelido,
// abreviação e duas ruas na mesma frase tornam esse vínculo inseguro. A guarda 1 só age quando o meio foi comprovado
// inexistente em TODOS os contratos; fora disso, a frase fica como o modelo escreveu, e quem segura a geração do meio
// inexistente é a ferramenta (por contrato). A guarda 2 mantém a regra (só troca quando nenhuma fatura tem a falta
// comprovada) e, com mais de um contrato, a troca não cita fatura nenhuma.
// Redação diferente das formas abaixo passa (limitação conhecida, como nas outras guardas).

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const frasesDe = (texto) => String(texto || '').split(/(?<=[.!?])\s+|\n+/).map((f) => f.trim()).filter(Boolean);
const MEIO = { pix: /\bpix\b|\bcopia e cola\b|\bqr ?code\b/, boleto: /\bboletos?\b|\bcodigo de barras\b|\blinha digitavel\b/ };
const NOME = { pix: 'PIX', boleto: 'boleto' };
const MEIOS = ['pix', 'boleto'];

function meiosDaJanela(mensagensDaJanela) {
  const janela = Array.isArray(mensagensDaJanela) ? mensagensDaJanela.filter(Boolean) : [];
  for (let i = janela.length - 1; i >= 0; i -= 1) {
    if (janela[i].de === 'ia' && Array.isArray(janela[i].meiosDaFatura)) return janela[i].meiosDaFatura;
  }
  return [];
}

function meiosDoTurno(contexto) {
  return contexto && Array.isArray(contexto.meiosDaFatura) ? contexto.meiosDaFatura : meiosDaJanela(contexto && contexto.mensagensDaJanela);
}

// O meio que TODAS as faturas conhecidas mostraram inexistente (com uma fatura que o tem, não dá para saber de qual se fala).
const inexistente = (meios, m) => Array.isArray(meios) && meios.length > 0 && meios.every((x) => x[m] === false);

// A frase AFIRMA que o meio não está disponível (só redação de disponibilidade: "não tem boleto em aberto" é outro assunto,
// e "não consigo enviar o boleto" pode ter outro motivo — falta saber de quem é a fatura, falta o CPF).
function afirmaIndisponibilidade(f, m) {
  const nome = m === 'pix' ? 'pix' : 'boletos?';
  return new RegExp(`\\bn[aã]o (?:ha|tem|temos|existe)\\s+(?:o\\s+|um\\s+)?(?:codigo\\s+)?${nome}\\s+(?:disponivel|para (?:esta|essa) fatura|des[st]a fatura)\\b`).test(f)
    || new RegExp(`\\b${nome}\\b(?:\\s+\\S+){0,5}?\\s+(?:nao esta disponivel|esta indisponivel|indisponivel)\\b`).test(f);
}
// A frase NEGA o meio (para a guarda 1, que só tira oferta): a indisponibilidade ou o "não consigo enviar o X".
function negaMeio(f, m) {
  const nome = m === 'pix' ? 'pix' : 'boletos?';
  return afirmaIndisponibilidade(f, m) || new RegExp(`\\bnao consigo (?:enviar|gerar|oferecer)\\s+(?:o\\s+)?${nome}\\b`).test(f);
}

// Revisão de A6/A7 (06/10/2026, I1): a oferta é avaliada por ORAÇÃO (a frase se divide em ";", ":" e "mas"/"porém") e pelo
// OBJETO — o meio oferecido vem depois do gatilho da oferta ("posso enviar o PIX", "quer que eu envie o PIX", "pode me
// pedir o PIX", "prefere boleto ou PIX?", "quer pagar por PIX?"), ou antes do "de novo" ("pedir o PIX de novo"), e não
// é negado logo antes ("sem PIX", "em vez do PIX", "não tenho PIX", "não consegui gerar o PIX"). Assim o fato do meio
// inexistente e a oferta do outro meio na mesma frase não se confundem com a oferta do inexistente.
const oracoesDe = (f) => f.split(/\s*[;:]\s*|,?\s+\b(?:mas|porem)\b\s+/).map((o) => o.trim()).filter(Boolean);
const OFERTA_ANTES = [
  /(?<!\bnao )\b(?:posso|podemos|consigo|vou|quer que eu|deseja que eu|gostaria que eu|prefere que eu)\b[^.?!]{0,40}?\b(?:enviar|envie|envio|mandar|mande|mando|gerar|gere|gero|passar|passe|emitir|emita)\b/,
  /\b(?:me pedir|pode pedir|pedir de novo|pedir novamente|solicitar)\b/,
  /\bprefere\b/,
  /\bquer pagar (?:por|com|no|pelo|via)\b/,
];
const OFERTA_DEPOIS = /\b(?:novamente|de novo)\b/;
const ESCOLHA = /\bboleto ou (?:o |por |pelo )?pix\b|\bpix ou (?:o |por |pelo )?boleto\b/;
const NEGADO_ANTES = /(?:\bsem|\bem vez d[oa]|\bno lugar d[oa]|\bnao (?:ha|tem|tenho|temos|existe|consegui \w+|foi possivel \w+))\s+(?:(?:o|um|a|de|do|da|codigo)\s+){0,2}$/;
// O convite a pedir de novo sem nomear o meio ("…, mas você pode pedir de novo depois") se refere ao meio da oração anterior.
const CONVITE_SEM_MEIO = /\b(?:pedir|solicitar|tentar)\b[^.?!]*\b(?:de novo|novamente)\b|\bme pedir\b|\bpode pedir\b/;
// A frase que só existe por causa da pergunta da escolha ("Assim que você escolher, eu vejo…") sai junto com ela.
const DEPENDE_DA_ESCOLHA = /^(?:e )?(?:assim que|quando|depois que|logo que) (?:voce )?(?:escolher|decidir|me disser)\b/;

function ofereceNaOracao(o, m, citadosAntes) {
  if (negaMeio(o, m)) return false;
  let citou = false;
  for (const x of o.matchAll(new RegExp(MEIO[m].source, 'g'))) {
    citou = true;
    const antes = o.slice(0, x.index);
    if (NEGADO_ANTES.test(antes)) continue;
    if (OFERTA_ANTES.some((r) => r.test(antes)) || OFERTA_DEPOIS.test(o.slice(x.index + x[0].length)) || ESCOLHA.test(o)) return true;
  }
  return !citou && citadosAntes.includes(m) && CONVITE_SEM_MEIO.test(o);
}
function ofereceNaFrase(f, m) {
  const citados = [];
  for (const o of oracoesDe(f)) {
    if (ofereceNaOracao(o, m, citados)) return true;
    for (const mm of MEIOS) if (MEIO[mm].test(o)) citados.push(mm);
  }
  return false;
}

const existe = (meios, m) => Array.isArray(meios) && meios.length > 0 && meios.every((x) => x[m] === true);

/** Os contratos da conversa: os informados (do cliente e do terceiro) e os que aparecem no estado dos meios. */
function contratosDaConversa(contratos, meios) {
  const ids = new Set();
  for (const c of Array.isArray(contratos) ? contratos : []) if (c && c.id != null) ids.add(String(c.id));
  for (const x of Array.isArray(meios) ? meios : []) if (x && x.contratoId != null) ids.add(String(x.contratoId));
  return ids;
}
// O meio é comprovado assim em TODOS os contratos da conversa (cada um com fatura conhecida); com um contrato só, como antes.
function emTodosOsContratos(meios, m, ids, teste) {
  if (ids.size <= 1) return teste(meios, m);
  return [...ids].every((id) => teste(meios.filter((x) => String(x.contratoId) === id), m));
}

function respostaSemOfertaDeMeioInexistente(texto, meios, { contratos = [] } = {}) {
  const lista = Array.isArray(meios) ? meios : [];
  const ids = contratosDaConversa(contratos, lista);
  const varios = ids.size > 1;
  const inex = { pix: emTodosOsContratos(lista, 'pix', ids, inexistente), boleto: emTodosOsContratos(lista, 'boleto', ids, inexistente) };
  if (!inex.pix && !inex.boleto) return { texto, alterado: false };
  const ficam = [];
  const tiradas = [];
  let anteriorTirada = false;
  for (const frase of frasesDe(texto)) {
    const f = norm(frase);
    anteriorTirada = MEIOS.some((m) => inex[m] && ofereceNaFrase(f, m)) || (anteriorTirada && DEPENDE_DA_ESCOLHA.test(f));
    if (anteriorTirada) tiradas.push(f);
    else ficam.push(frase);
  }
  if (tiradas.length === 0) return { texto, alterado: false };
  const resto = ficam.join(' ').trim();
  const dizIndisponivel = (m) => frasesDe(resto).some((frase) => negaMeio(norm(frase), m));
  const os2 = inex.pix && inex.boleto;
  const meioUnico = inex.pix ? 'pix' : 'boleto';
  const outro = meioUnico === 'pix' ? 'boleto' : 'pix';
  const jaDiz = os2 ? dizIndisponivel('pix') && dizIndisponivel('boleto') : dizIndisponivel(meioUnico);
  const partes = [resto];
  if (!jaDiz) {
    const fato = varios
      ? (os2 ? 'Nenhuma das faturas consultadas tem PIX nem boleto disponível por aqui agora. Se quiser, posso encaminhar você para um atendente.'
        : `O ${NOME[meioUnico]} não está disponível agora em nenhuma das faturas consultadas.`)
      : (os2 ? 'Esta fatura não tem PIX nem boleto disponível por aqui agora. Se quiser, posso encaminhar você para um atendente.'
        : `O ${NOME[meioUnico]} desta fatura não está disponível agora.`);
    partes.push(fato);
  }
  // A oferta verdadeira que a frase tirada trazia (o outro meio, que a 2ª via mostrou existir) volta, se o resto não a tem.
  // (Aqui o meio tirado falta em todos os contratos, então todos têm fatura conhecida: existir em todas as faturas é existir em todos.)
  if (!os2 && existe(lista, outro) && tiradas.some((f) => ofereceNaFrase(f, outro))
    && !frasesDe(resto).some((frase) => ofereceNaFrase(norm(frase), outro))) {
    partes.push(varios ? `Se quiser, posso enviar o ${NOME[outro]}.` : `Se quiser, posso enviar o ${NOME[outro]} dela.`);
  }
  return { texto: partes.join(' ').trim(), alterado: true };
}

function respostaSemIndisponibilidadeNaoConfirmada(texto, meios, { cobrancaComResposta = false, contratos = [] } = {}) {
  const lista = Array.isArray(meios) ? meios : [];
  const varios = contratosDaConversa(contratos, lista).size > 1;
  // Sem resultado: o pedido do meio falhou (null, sem nenhuma fatura comprovando a falta), ou nada se sabe e nenhuma
  // ferramenta de cobrança respondeu neste turno.
  const semResultado = (m) => !inexistente(lista, m)
    && ((lista.some((x) => x[m] === null) && !lista.some((x) => x[m] === false)) || (lista.length === 0 && !cobrancaComResposta));
  const saida = [];
  let alterado = false;
  for (const frase of frasesDe(texto)) {
    const f = norm(frase);
    const naoConfirmados = MEIOS.filter((m) => afirmaIndisponibilidade(f, m) && semResultado(m));
    if (naoConfirmados.length === 0) {
      saida.push(frase);
      continue;
    }
    alterado = true;
    const nomes = naoConfirmados.length === 2 ? 'o PIX e o boleto estão disponíveis' : `o ${NOME[naoConfirmados[0]]} está disponível`;
    const troca = `Não consegui confirmar agora se ${nomes}${varios ? '' : ' para esta fatura'}.`;
    if (!saida.includes(troca)) saida.push(troca);
  }
  return alterado ? { texto: saida.join(' ').trim(), alterado } : { texto, alterado: false };
}

module.exports = { meiosDaJanela, meiosDoTurno, respostaSemOfertaDeMeioInexistente, respostaSemIndisponibilidadeNaoConfirmada };
