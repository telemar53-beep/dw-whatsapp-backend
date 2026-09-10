function greetingForNow(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
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
