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

// Trabalho em andamento ou por vir.
const FUTURA = [
  /\b(?:vou|irei|vamos|iremos)\s+(?:(?:te|lhe|ja|agora|so|entao|logo)\s+)*([a-z]+)/,
  /\b(?:estou|to|estamos)\s+(?:[a-z]+\s+)?[a-z]+ndo\b/,
  /\bja\s+(?:te\s+|lhe\s+)?(?:envio|mando|gero|passo|reenvio|emito|providencio)\b/,
  /\b(?:em instantes|em seguida|ja ja|daqui a pouco|aguarde)\b/,
  /\b(?:sera|serao|vai ser|vao ser)\s+(?:enviad|gerad|mandad|reenviad|emitid|providenciad)/,
];
// A necessidade de algo dele não é trabalho da IA ("vou precisar que você escolha").
const VERBOS_QUE_PEDEM = new Set(['precisar', 'pedir', 'perguntar']);

// Entrega dada como feita.
const CONCLUIDA = [
  /\b(?:enviei|mandei|gerei|reenviei|emiti)\b/,
  /\b(?:segue|seguem)\s+(?:(?:o|a|os|as|abaixo|acima|aqui|anexo|em anexo|seu|sua)\s+)*(?:pix|boletos?|faturas?|segunda via|codigo|linha digitavel|pdf)\b/,
  /\b(?:foi|foram|esta|estao)\s+(?:ja\s+)?(?:enviad|gerad|mandad|reenviad|emitid)/,
  /\b(?:esta|estao)\s+(?:ai|acima|aqui)\b/,
];

const DEPENDE_DELE = /\b(?:se (?:voce |vc )?(?:quiser|preferir|precisar|confirmar|escolher|pedir|me (?:disser|pedir|confirmar|mandar|enviar|responder))|caso (?:voce |vc )?(?:queira|prefira|precise|confirme)|(?:assim que|quando|depois que|logo que) (?:voce|vc|o senhor|a senhora|me)\b)/;
const ENCAMINHAMENTO = /\b(?:transferir|encaminhar|direcionar|passar)\b[^.!?]{0,40}\b(?:setor|financeiro|atendente|equipe|time|colega|especialista)\b|\b(?:sera|vai ser)\s+(?:encaminhad|transferid|direcionad)/;

// O índice da primeira forma que casa (ou -1), para conferir se a negação vem antes dela.
function primeiraForma(f, formas, aceita = () => true) {
  let menor = -1;
  for (const r of formas) {
    const m = r.exec(f);
    if (m && aceita(m) && (menor < 0 || m.index < menor)) menor = m.index;
  }
  return menor;
}
const negadaAntes = (f, i) => /\bnao\b/.test(f.slice(0, i));

/** Os motivos pelos quais UMA frase não pode sair, dado o estado da ação. */
function motivosDaFrase(frase, { entregaNoTurno = false, entregaAnterior = false } = {}) {
  if (entregaNoTurno) return [];
  const f = norm(frase);
  if (!COBRANCA.test(f) || /\?\s*$/.test(f) || DEPENDE_DELE.test(f) || ENCAMINHAMENTO.test(f)) return [];
  const motivos = [];
  const futura = primeiraForma(f, FUTURA, (m) => !(m[1] && VERBOS_QUE_PEDEM.has(m[1])));
  if (futura >= 0 && !negadaAntes(f, futura)) motivos.push('entrega_futura');
  if (!entregaAnterior) {
    const concluida = primeiraForma(f, CONCLUIDA);
    if (concluida >= 0 && !negadaAntes(f, concluida)) motivos.push('entrega_concluida');
  }
  return motivos;
}

/** Os motivos da resposta (vazio: pode sair como está). `estado`: { entregaNoTurno, entregaAnterior }. */
function violacoesDaEntrega(texto, estado) {
  return [...new Set(frasesDe(texto).flatMap((f) => motivosDaFrase(f, estado)))];
}

const ENTREGA_NAO_FEITA = 'Ainda não enviei a cobrança.';

/**
 * A resposta sem as frases que apresentam a entrega sem o fato. Se alguma saiu e o que sobra não pergunta nada a ele, entra a
 * frase honesta de que a cobrança não foi enviada (sem nada que sobre, só ela).
 */
function respostaSemEntregaSemFato(texto, estado) {
  const frases = frasesDe(texto);
  const ficam = frases.filter((f) => motivosDaFrase(f, estado).length === 0);
  if (ficam.length === frases.length) return texto;
  const resto = ficam.join(' ').trim();
  if (!resto) return ENTREGA_NAO_FEITA;
  return /\?/.test(resto) ? resto : `${resto} ${ENTREGA_NAO_FEITA}`;
}

module.exports = { violacoesDaEntrega, respostaSemEntregaSemFato, ENTREGA_NAO_FEITA };
