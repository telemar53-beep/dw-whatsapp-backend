export function channelSummary(channel, { triageOptionsCount = 0, nightWindowSet = false, openAiReady = false } = {}) {
  const chips = [];
  const warnings = [];
  if (channel.triageEnabled) {
    chips.push('Triagem por menu');
    if (triageOptionsCount === 0) warnings.push('Triagem por menu ligada sem opções cadastradas');
  }
  if (channel.aiEnabled) {
    chips.push('IA');
    if (!openAiReady) warnings.push('IA ligada sem OpenAI configurada');
  }
  if (channel.aiTriageEnabled) chips.push('Triagem IA');
  if (channel.aiNightModeEnabled) {
    chips.push('Noturno');
    if (!nightWindowSet) warnings.push('Noturno ligado sem janela definida');
  }
  return { chips, warnings };
}
