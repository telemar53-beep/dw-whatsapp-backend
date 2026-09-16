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
  // Print 2026-09-16: "Boa tarde, Agnieska! Agnieska, vou encaminhar..." — o
  // modelo já tinha começado chamando pela pessoa e o prefixo dobrou o nome.
  let corpo = String(texto);
  if (primeiroNome) {
    const escapado = primeiroNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const comecaComNome = new RegExp(`^${escapado},\\s*`, 'i');
    if (comecaComNome.test(corpo)) {
      corpo = corpo.replace(comecaComNome, '');
      corpo = corpo.charAt(0).toUpperCase() + corpo.slice(1);
    }
  }
  return `${saudacaoDaHora(agora)}${nome}! ${corpo}`;
}

// "Bom dia" às 14:56 (teste real 2026-09-13): o modelo sabia a hora pelo
// prompt e errou mesmo assim. Uma saudação de período no começo do texto é
// trocada pela do período certo; "Olá"/"Oi" ficam como estão.
const SAUDACAO_DE_PERIODO = /^([\s\p{Extended_Pictographic}*_~]*)(bom dia|boa tarde|boa noite)/iu;

function corrigirPeriodoDaSaudacao(texto, agora = new Date()) {
  if (!texto) return texto;
  const certa = saudacaoDaHora(agora);
  return String(texto).replace(SAUDACAO_DE_PERIODO, (tudo, prefixo, achada) => {
    if (achada.toLowerCase() === certa.toLowerCase()) return tudo;
    // Preserva caixa: "BOM DIA" → "BOA TARDE", "bom dia" → "boa tarde".
    const ajustada = achada === achada.toUpperCase() ? certa.toUpperCase()
      : achada === achada.toLowerCase() ? certa.toLowerCase() : certa;
    return prefixo + ajustada;
  });
}

// Print 2026-09-16: "Bom dia! Como posso ajudar você hoje?" em toda resposta
// da mesma conversa — o modelo cumprimenta de novo mesmo com o prompt
// mandando cumprimentar só na primeira. Da segunda resposta em diante o
// worker tira a saudação de período (com ou sem nome) do começo. "Olá"/"Oi"
// ficam; um texto que fosse só a saudação volta como veio.
const SAUDACAO_INICIAL = /^([\s\p{Extended_Pictographic}*_~]*)(bom dia|boa tarde|boa noite)(,?\s*[^!.,\n]{0,40})?[!.,]*\s*/iu;

function removerSaudacao(texto) {
  if (!texto) return texto;
  const sem = String(texto).replace(SAUDACAO_INICIAL, '');
  if (!sem.trim() || sem === texto) return texto;
  return sem.charAt(0).toUpperCase() + sem.slice(1);
}

module.exports = { saudacaoDaHora, comecaComSaudacao, garantirSaudacao, corrigirPeriodoDaSaudacao, removerSaudacao };
