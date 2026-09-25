// Quem assina a bolha de saída. Mensagem automática (Fase 1B, 25/09/2026) se reconhece pela
// origem gravada pelo backend em `metadata.origem` — nunca pela ausência de texto. Um disparo
// do SGP ou uma campanha não é "Atendente".
//
// Peça reutilizável: a Fase 1 (aviso de instabilidade) acrescenta aqui o rótulo da sua origem.
const ROTULOS_DE_ORIGEM = {
  sgp: 'Automática · SGP',
  campanha: 'Campanha',
};

export function rotuloDoAutor(message) {
  const origem = message && message.metadata && message.metadata.origem;
  if (origem && ROTULOS_DE_ORIGEM[origem]) return ROTULOS_DE_ORIGEM[origem];
  return message && message.sentBy === 'ai' ? 'Assistente IA' : 'Atendente';
}
