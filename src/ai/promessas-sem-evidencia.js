// Promessas e horários sem evidência na resposta da IA (conclusão do atendimento, 04/10/2026). Puro.
//
// Evidência (avaliação de 01/10, falhas 1 e 5; micropiloto 2, E3): o modelo inventou "nosso atendimento funciona hoje até
// as 18h" (enviado) e prometeu "vou tentar novamente com o financeiro", "um atendente vai entrar em contato" — nada disso
// tem fonte no sistema: não há horário de atendimento nos fatos do turno, e nenhuma nova tentativa, retorno ou
// acompanhamento é agendado. As guardas existentes cobrem só anúncio de encaminhamento, envio e liberação.
//
// O que sai (a frase inteira; o resto da resposta fica):
// - promessa de trabalho futuro da IA (nova tentativa, retorno, aviso, acompanhamento) — nunca há trabalho agendado;
//   fica só a nova tentativa condicionada a um pedido do cliente e sem adiamento ("se quiser, vou tentar de novo agora"),
//   porque ela só acontece se ele pedir; retorno, aviso e acompanhamento saem mesmo condicionados;
// - promessa de ação da equipe ("um atendente vai entrar em contato", "será tratado por um atendente") — fica só quando
//   o encaminhamento foi confirmado NESTE turno (a conversa está na fila);
// - horário ou duração em horas sem fonte — fica só o horário que um fato do sistema trouxe (o retorno da equipe no modo
//   noturno, configurado no painel).
// São detectores de AFIRMAÇÃO da IA, como os que já existem: não interpretam o pedido do cliente. Redação diferente das
// formas abaixo passa (limitação conhecida, como nas outras guardas).

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Frases da resposta, com a pontuação de cada uma (quebra de linha também separa).
const frasesDe = (texto) => String(texto || '').split(/(?<=[.!?])\s+|\n+/).map((f) => f.trim()).filter(Boolean);

// Só um pedido do cliente condiciona ("se quiser", "caso queira", "se me pedir"); "se não der certo" não é pedido dele.
const CONDICIONADA_AO_CLIENTE = /\b(?:se (?:voce )?quiser|se (?:voce )?preferir|caso (?:voce )?queira|se (?:voce )?(?:me )?(?:escrever|pedir|chamar|mandar))\b/;
// Adiamento: a tentativa ficaria para depois, sem ninguém para executá-la.
const ADIADA = /\b(?:depois|mais tarde|assim que|daqui a|amanha)\b/;

const NOVA_TENTATIVA = [
  /\b(?:vou|irei|vamos|iremos)\s+(?:tentar\s+)?(?:de novo|novamente|outra vez)\b/,
  /\btentarei\s+(?:de novo|novamente|outra vez)\b/,
  /\btento\s+(?:de novo|novamente|outra vez)\s+(?:depois|mais tarde|em seguida|assim que)\b/,
];

const RETORNO_OU_ACOMPANHAMENTO = [
  /\b(?:vou|irei)\s+(?:te\s+|lhe\s+)?(?:retornar|avisar|dar (?:um )?retorno)\b/,
  /\b(?:te|lhe)\s+(?:retorno|aviso)\b/,
  /\bfico\s+acompanhando\b|\b(?:vou|irei)\s+acompanhar\b/,
  /\bestou\s+tentando\s+(?:encaminhar|transferir|passar)\b/,
];

const PROMESSA_DA_EQUIPE = [
  /\bum[a]?\s+(?:atendente|colega|especialista|pessoa da (?:nossa )?equipe)\s+(?:vai|ira)\s+(?:entrar em contato|te chamar|te responder|responder|retornar|falar com voce|continuar|conferir|verificar|analisar|cuidar|te atender|atender)\b/,
  // Revisão (04/10/2026): "a equipe responsável vai orientar" — uma palavra entre equipe e o verbo.
  /\b(?:nossa |a )?equipe(?:\s+[a-z]+)?\s+(?:vai|ira)\s+(?:conferir|verificar|analisar|entrar em contato|retornar|te chamar|responder|cuidar|te atender|atender|orientar|tratar|resolver)\b/,
  /\bsera\s+(?:tratad|atendid|analisad|verificad|conferid|resolvid)[oa]s?\s+por\b/,
  /\bvoce\s+sera\s+(?:atendid|direcionad|encaminhad|transferid|chamad)[oa]\b/,
];

// "18h", "8h30", "18hs", "8 horas", "18:00". Fica de fora o que não é hora (valores, datas, protocolos).
const HORA = /\b([01]?\d|2[0-3])(?:h([0-5]\d)?|\s?(?:hs|hrs|horas)\b|:([0-5]\d))(?![\d:])/g;

function minutosDe(token) {
  const m = /^([01]?\d|2[0-3])(?::|h)?([0-5]\d)?/.exec(token.replace(/\s+/g, ''));
  return m ? Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0) : null;
}

// Duração em horas acima de 23 ("até 72 horas", "24h"): prazo, que também não tem fonte no sistema.
const DURACAO_EM_HORAS = /\b(?:2[4-9]|[3-9]\d|\d{3})\s?(?:h|hs|hrs|horas)\b/g;
const numeroDe = (token) => Number(String(token).match(/\d+/)[0]);

// Revisão (04/10/2026): o horário ou a duração que está no texto com fonte (o prompt do turno: aviso de cidade,
// instruções do painel, fatos) tem fonte, como o retorno do modo noturno.
function horasSemFonte(frase, horariosConfirmados, textoComFonte) {
  const fonte = norm(textoComFonte);
  const permitidos = new Set([...(horariosConfirmados || []), ...(fonte.match(HORA) || [])].map(minutosDe).filter((x) => x != null));
  const duracoesDaFonte = new Set((fonte.match(DURACAO_EM_HORAS) || []).map(numeroDe));
  const f = norm(frase);
  if ((f.match(DURACAO_EM_HORAS) || []).some((d) => !duracoesDaFonte.has(numeroDe(d)))) return true;
  const achadas = f.match(HORA) || [];
  return achadas.some((h) => !permitidos.has(minutosDe(h)));
}

/**
 * Os motivos pelos quais uma frase não pode sair (vazio: pode).
 * `encaminhamentoConfirmado`: a conclusão confirmou NESTE turno. `horariosConfirmados`: horários que um fato do sistema
 * trouxe (ex.: '08:00' do modo noturno). `textoComFonte`: o prompt do turno — horário ou duração escritos nele têm fonte.
 */
function motivosDaFrase(frase, { encaminhamentoConfirmado = false, horariosConfirmados = [], textoComFonte = '' } = {}) {
  const f = norm(frase);
  const motivos = [];
  const tentativaCondicionada = CONDICIONADA_AO_CLIENTE.test(f) && !ADIADA.test(f);
  if ((!tentativaCondicionada && NOVA_TENTATIVA.some((r) => r.test(f))) || RETORNO_OU_ACOMPANHAMENTO.some((r) => r.test(f))) motivos.push('promessa_da_ia');
  if (!encaminhamentoConfirmado && PROMESSA_DA_EQUIPE.some((r) => r.test(f))) motivos.push('promessa_da_equipe');
  if (horasSemFonte(frase, horariosConfirmados, textoComFonte)) motivos.push('horario_sem_fonte');
  return motivos;
}

/** Todos os motivos da resposta (vazio: a resposta pode sair como está). */
function promessasSemEvidencia(texto, opcoes) {
  return [...new Set(frasesDe(texto).flatMap((f) => motivosDaFrase(f, opcoes)))];
}

const SEM_INFORMACAO_CONFIRMADA = 'Não tenho essa informação confirmada por aqui.';

/**
 * A resposta sem as frases que não podem sair. A frase cujo único problema é o horário sem fonte dá lugar, uma vez, à de
 * que não há informação confirmada (revisão de 04/10/2026: a pergunta de horário não fica sem resposta). Sem nada que
 * sobre, a frase `seNadaSobrar` (do chamador, conforme o turno) ou a de que não há informação confirmada.
 */
function respostaSemPromessas(texto, opcoes = {}) {
  const saida = [];
  let semInformacao = false;
  for (const frase of frasesDe(texto)) {
    const motivos = motivosDaFrase(frase, opcoes);
    if (motivos.length === 0) saida.push(frase);
    else if (motivos.length === 1 && motivos[0] === 'horario_sem_fonte' && !semInformacao) {
      saida.push(SEM_INFORMACAO_CONFIRMADA);
      semInformacao = true;
    }
  }
  return saida.join(' ').trim() || opcoes.seNadaSobrar || SEM_INFORMACAO_CONFIRMADA;
}

module.exports = { promessasSemEvidencia, respostaSemPromessas, motivosDaFrase, SEM_INFORMACAO_CONFIRMADA };
