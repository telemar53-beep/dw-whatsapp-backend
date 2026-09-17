const { saudacaoDaHora } = require('../ai/saudacao');

// Havia duas saudacoes no projeto e elas discordavam: a da IA calculava a hora
// no fuso de Sao Paulo, esta lia `date.getHours()` — a hora local do SERVIDOR.
// O Render roda em UTC, entao 9h da manha em Sao Paulo virava 12h e o cliente
// recebia "Boa tarde" na mensagem de abertura (relatado em 2026-09-17).
//
// Agora existe uma regra so, em ai/saudacao.js, que e quem sabe dizer que horas
// sao no Brasil. Duplicar isso de novo e como o bug volta.
function greetingForNow(date = new Date()) {
  return saudacaoDaHora(date);
}

function firstNameOf(fullName) {
  return fullName.trim().split(/\s+/)[0];
}

function substituteAssignmentPlaceholders(template, { agentName, protocolNumber }) {
  return template
    .split('@chat_saudacao_maiusculo').join(greetingForNow())
    .split('@chat_atendente').join(firstNameOf(agentName))
    .split('@chat_protocolo').join(String(protocolNumber));
}

module.exports = { greetingForNow, firstNameOf, substituteAssignmentPlaceholders };
