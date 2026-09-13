// Modo noturno com IA: fora da janela configurada (todos os dias, feriado
// incluído, atravessando a meia-noite), a triagem atende sozinha. Calculado
// por turno, nunca por conversa — uma conversa que começa 19:55 vira noturna
// no turno das 20:10.
const FUSO = 'America/Sao_Paulo';

function minutosEmSaoPaulo(agora) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(agora);
  const hora = Number(partes.find((p) => p.type === 'hour').value) % 24;
  const minuto = Number(partes.find((p) => p.type === 'minute').value);
  return hora * 60 + minuto;
}

function minutosDe(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function dentroDaJanela(agora, inicio, fim) {
  const i = minutosDe(inicio);
  const f = minutosDe(fim);
  if (i == null || f == null || i === f) return false;
  const n = minutosEmSaoPaulo(agora);
  return i < f ? n >= i && n < f : n >= i || n < f;
}

function isNightModeActive({ channel, config, agora = new Date() }) {
  if (!channel || !channel.aiEnabled || !channel.aiTriageEnabled || !channel.aiNightModeEnabled) return false;
  if (!config) return false;
  return dentroDaJanela(agora, config.nightStartTime, config.nightEndTime);
}

module.exports = { dentroDaJanela, isNightModeActive, minutosDe };
