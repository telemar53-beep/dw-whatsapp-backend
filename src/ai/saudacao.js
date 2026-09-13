// Saudação da primeira resposta da IA. Pedido do dono (teste real
// 2026-09-13): "quando o cliente mandar mensagem pedindo pix ou qualquer
// outra informação, ele sempre recebe uma saudação antes". O prompt já
// mandava cumprimentar e o modelo esqueceu na hora de entregar o PIX — então
// a garantia é aqui, em código, aplicada pelo worker na primeira resposta de
// cada atendimento em triagem.
const FUSO = 'America/Sao_Paulo';

function horaEmBrasilia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: 'numeric', hour12: false }).formatToParts(agora);
  const hora = partes.find((p) => p.type === 'hour');
  return hora ? Number(hora.value) % 24 : agora.getHours();
}

/** 'Bom dia' até 11:59, 'Boa tarde' de 12:00 a 17:59, 'Boa noite' depois (fuso de São Paulo). */
function saudacaoDaHora(agora = new Date()) {
  const h = horaEmBrasilia(agora);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Aceita o que o modelo costuma escrever no começo: saudação da hora, "olá",
// "oi", "bem-vindo", com ou sem emoji/pontuação na frente.
const COMECA_COM_SAUDACAO = /^[\s\p{Extended_Pictographic}*_~]*(bom dia|boa tarde|boa noite|ol[áa]|oi\b|e a[íi]\b|bem[- ]vind[oa])/iu;

function comecaComSaudacao(texto) {
  return COMECA_COM_SAUDACAO.test(String(texto || ''));
}

/**
 * Garante que a resposta comece com a saudação da hora e o primeiro nome
 * ("Bom dia, João! …"). Se o modelo já cumprimentou, devolve o texto como
 * veio — nunca "Bom dia! Bom dia, João!".
 */
function garantirSaudacao(texto, primeiroNome, agora = new Date()) {
  if (!texto || comecaComSaudacao(texto)) return texto;
  const nome = primeiroNome ? `, ${primeiroNome}` : '';
  return `${saudacaoDaHora(agora)}${nome}! ${texto}`;
}

module.exports = { saudacaoDaHora, comecaComSaudacao, garantirSaudacao };
