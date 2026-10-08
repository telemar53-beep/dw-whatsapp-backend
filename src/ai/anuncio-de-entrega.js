// Rodada 10 (08/10/2026; ordem, item 3, G1): sem entrega, o texto final não a apresenta como concluída nem como trabalho que
// continuará sozinho. Puro.
//
// Evidência (avaliação real S5, r3, conversa #3, 08/10): depois da correção do documento, o modelo respondeu "Posso sim,
// Sicrano. Vou usar a fatura do endereço da Rua de Teste…" sem chamar a ferramenta — nada foi enviado, e a resposta dizia que
// algo ia acontecer. A guarda de anúncio (afirmaEnvio) só conhecia uma lista de verbos ("vou enviar/mandar/gerar…").
//
// A proteção depende do ESTADO da ação, não de uma frase: (1) com entrega neste turno, nada aqui age; (2) sem entrega neste
// turno, a frase que apresenta a cobrança como trabalho em andamento ou por vir — futuro da IA ("vou/irei/vamos" + qualquer
// verbo), gerúndio ("estou gerando"), presente com "já" ("já te mando"), espera ("em seguida", "já já") ou passiva futura
// ("será enviado") — sai, porque nada continua depois desta mensagem; (3) sem entrega nenhuma nesta conversa, também sai a
// frase que a dá como feita ("enviei", "segue o boleto", "já foi enviado", "está aí"). Só frases que citam a cobrança.
//
// Explicações legítimas ficam: a pergunta; a negação ("não consegui enviar", "o boleto não foi enviado"); o que depende dele
// ("se quiser, vou enviar", "assim que você escolher…"); o encaminhamento (tem guarda própria); e a necessidade de algo dele
// ("vou precisar que você…"). Limites: é leitura da forma da frase — redação fora destas formas passa; com uma entrega no
// turno, a promessa de outro meio no mesmo turno também passa.

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const frasesDe = (texto) => String(texto || '').split(/(?<=[.!?])\s+|\n+/).map((f) => f.trim()).filter(Boolean);

const COBRANCA = /\b(?:pix|boletos?|faturas?|segunda via|2a via|codigo|qr ?code|copia e cola|linha digitavel|cobrancas?|pdf)\b/;

// Trabalho em andamento ou por vir. Revisão da rodada 10 (A3-2/A3-3): "aguarde" e "em seguida" saíram ("Aguarde a compensação
// do PIX", "em seguida me envie o comprovante" são do cliente), e a cobrança tem de estar na MESMA oração da forma.
const FUTURA = [
  /\b(?:vou|irei|vamos|iremos)\s+(?:(?:te|lhe|ja|agora|so|entao|logo)\s+)*([a-z]+)/,
  /\b(?:estou|to|estamos)\s+(?:[a-z]+\s+)?(?:enviando|reenviando|mandando|gerando|preparando|providenciando|emitindo|separando|verificando|conferindo|buscando|puxando)\b/,
  /\bja\s+(?:te\s+|lhe\s+)?(?:envio|mando|gero|passo|reenvio|emito|providencio)\b/,
  /\b(?:em instantes|ja ja)\b/,
  /\b(?:sera|serao|vai ser|vao ser)\s+(?:enviad|gerad|mandad|reenviad|emitid|providenciad)/,
  // Revisão do incremento (R2): "daqui a pouco o boleto chega", "o boleto está sendo gerado".
  /\bdaqui a pouco\b[^.!?;:]*\b(?:chega|recebe|sai|envio|mando|vai)\b/,
  /\b(?:esta|estao)\s+sendo\s+(?:enviad|gerad|mandad|reenviad|emitid|providenciad|preparad)/,
];
// A necessidade de algo dele não é trabalho da IA ("vou precisar que você escolha"), nem a explicação ("vou te explicar como…").
const VERBOS_QUE_PEDEM = new Set(['precisar', 'pedir', 'perguntar', 'explicar', 'dizer', 'falar', 'mostrar', 'orientar', 'contar']);
// Os verbos de entrega: com eles, a cobrança citada em outra oração da mesma frase é o objeto ("como o boleto não chegou, vou te
// enviar de novo"). O gerúndio e as outras formas já são de entrega.
const VERBOS_DE_ENTREGA = /^(?:enviar|mandar|reenviar|gerar|emitir|providenciar|passar|usar|seguir|separar|preparar|verificar|conferir|buscar|pegar|puxar)$/;

// Entrega dada como feita.
const CONCLUIDA = [
  /\b(?:enviei|mandei|gerei|reenviei|emiti)\b/,
  /\b(?:segue|seguem)\s+(?:(?:o|a|os|as|abaixo|acima|aqui|anexo|em anexo|seu|sua)\s+)*(?:pix|boletos?|faturas?|segunda via|codigo|linha digitavel|pdf)\b/,
  /\b(?:foi|foram|esta|estao)\s+(?:ja\s+)?(?:enviad|gerad|mandad|reenviad|emitid)/,
  /\b(?:esta|estao)\s+(?:ai|acima|aqui)\b/,
];

const DEPENDE_DELE = /\b(?:se (?:voce |vc )?(?:quiser|preferir|precisar|confirmar|escolher|pedir|me (?:disser|pedir|confirmar|mandar|enviar|responder))|caso (?:voce |vc )?(?:queira|prefira|precise|confirme)|(?:assim que|quando|depois que|logo que) (?:voce|vc|o senhor|a senhora|me)\b)/;
const ENCAMINHAMENTO = /\b(?:transferir|encaminhar|direcionar|passar)\b[^.!?]{0,40}\b(?:setor|financeiro|atendente|equipe|time|colega|especialista)\b|\b(?:sera|vai ser)\s+(?:encaminhad|transferid|direcionad)/;

// Revisão da rodada 10 (A3-1): a negação só vale na MESMA oração e colada à forma (até duas palavras antes): "o boleto não foi
// enviado", "ainda não enviei", "eu não vou conseguir enviar". O "não" de outra oração ("Não se preocupe, vou enviar o boleto")
// não nega nada. Vale para o texto cru (afirmaEnvio) e para o normalizado.
const FIM_DE_ORACAO = /[,;:.!?\u2014]/;
function negacaoColada(prefixo) {
  const p = String(prefixo || '');
  let corte = -1;
  for (let k = p.length - 1; k >= 0; k -= 1) if (FIM_DE_ORACAO.test(p[k])) { corte = k; break; }
  // Revisão do incremento (R3): entre o "não" e a forma, só palavras auxiliares ("não se preocupe vou enviar" não é negação).
  return /(?:^|\s)n(?:ã|a)o\s+(?:(?:vou|vamos|irei|iremos|ainda|te|lhe|me|conseguir|consegui|consigo|posso|pude|foi|foram|est(?:á|a)|est(?:ã|a)o|j(?:á|a)|mais|vai|ser(?:á|a))\s+){0,3}$/i.test(p.slice(corte + 1));
}
// A oração em volta de um índice (entre os sinais de fim de oração).
function oracaoEm(f, i) {
  let ini = 0;
  for (let k = i - 1; k >= 0; k -= 1) if (FIM_DE_ORACAO.test(f[k])) { ini = k + 1; break; }
  let fim = f.length;
  for (let k = i; k < f.length; k += 1) if (FIM_DE_ORACAO.test(f[k])) { fim = k + 1; break; }
  return f.slice(ini, fim);
}
// Alguma ocorrência de alguma forma — TODAS são conferidas (revisão do incremento, R3: "Não vou mandar o PIX, vou mandar o boleto")
// — com a cobrança na mesma oração (ou, com verbo de entrega, na frase), sem negação colada e, para a entrega feita, fora da
// oração que pergunta.
function algumaForma(f, formas, { aceita = () => true, foraDaPergunta = false } = {}) {
  for (const r of formas) {
    const g = new RegExp(r.source, 'g');
    let m;
    while ((m = g.exec(f))) {
      if (!m[0]) { g.lastIndex += 1; continue; }
      if (!aceita(m)) continue;
      const naFrase = !m[1] || VERBOS_DE_ENTREGA.test(m[1]);
      if (!naFrase && !COBRANCA.test(oracaoEm(f, m.index))) continue;
      if (foraDaPergunta && /\?\s*$/.test(oracaoEm(f, m.index))) continue;
      if (negacaoColada(f.slice(0, m.index))) continue;
      return true;
    }
  }
  return false;
}

/** Os motivos pelos quais UMA frase não pode sair, dado o estado da ação. */
function motivosDaFrase(frase, { entregaNoTurno = false, entregaAnterior = false } = {}) {
  if (entregaNoTurno) return [];
  const f = norm(frase);
  if (!COBRANCA.test(f) || DEPENDE_DELE.test(f) || ENCAMINHAMENTO.test(f)) return [];
  const motivos = [];
  // A pergunta isenta o anúncio ("Posso enviar o boleto?"); a afirmação de entrega feita, só se a própria oração for a pergunta
  // (revisão da rodada 10, A3-4: "Enviei o boleto acima, conseguiu abrir?" continua afirmação).
  if (!/\?\s*$/.test(f) && algumaForma(f, FUTURA, { aceita: (m) => !(m[1] && VERBOS_QUE_PEDEM.has(m[1])) })) motivos.push('entrega_futura');
  if (!entregaAnterior && algumaForma(f, CONCLUIDA, { foraDaPergunta: true })) motivos.push('entrega_concluida');
  return motivos;
}

/** Os motivos da resposta (vazio: pode sair como está). `estado`: { entregaNoTurno, entregaAnterior }. */
function violacoesDaEntrega(texto, estado) {
  return [...new Set(frasesDe(texto).flatMap((f) => motivosDaFrase(f, estado)))];
}

const ENTREGA_NAO_FEITA = 'Ainda não enviei a cobrança.';
// Revisão da rodada 10 (A3-2): com uma entrega anterior na conversa, "ainda não enviei" seria falso.
const NADA_NOVO_ENVIADO = 'Não enviei nenhuma cobrança nova agora.';

/**
 * A correção no laço (sem ferramenta obrigatória). Revisão da rodada 10 (A3-5): no turno do limite de perguntas, não manda
 * perguntar — a triagem conclui.
 */
function correcaoDaEntrega({ forcarConclusao = false } = {}) {
  const base = 'NADA foi enviado ao cliente neste turno. A resposta não pode dizer que a cobrança foi enviada, nem que você vai enviá-la, usá-la, gerá-la ou verificá-la depois: nada continua sozinho depois desta mensagem.';
  return forcarConclusao
    ? `${base} Esta é a última resposta da triagem: se o pedido dele já pode ser atendido, atenda agora pelas ferramentas (elas conferem tudo de novo); se não, não faça perguntas — chame concluir_triagem para o setor que cuidar de financeiro, com o que falta no resumo.`
    : `${base} Responda de novo, sem anunciar: se o pedido dele já pode ser atendido, atenda agora pelas ferramentas (elas conferem tudo de novo); se falta alguma coisa, pergunte só o que falta; se não dá para enviar, diga com honestidade que não enviou e por quê.`;
}

/**
 * A resposta sem as frases que apresentam a entrega sem o fato. Se alguma saiu e o que sobra não pergunta nada a ele, entra a
 * frase honesta de que a cobrança não foi enviada (sem nada que sobre, só ela).
 */
function respostaSemEntregaSemFato(texto, estado) {
  const frases = frasesDe(texto);
  const ficam = frases.filter((f) => motivosDaFrase(f, estado).length === 0);
  if (ficam.length === frases.length) return texto;
  const honesta = estado && estado.entregaAnterior ? NADA_NOVO_ENVIADO : ENTREGA_NAO_FEITA;
  const resto = ficam.join(' ').trim();
  if (!resto) return honesta;
  return /\?/.test(resto) ? resto : `${resto} ${honesta}`;
}

module.exports = { violacoesDaEntrega, respostaSemEntregaSemFato, ENTREGA_NAO_FEITA, NADA_NOVO_ENVIADO, correcaoDaEntrega, negacaoColada };
