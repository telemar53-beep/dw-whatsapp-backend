/**
 * Formata um erro para log sem vazar dados sensíveis: usa só a mensagem
 * própria e, quando houver, a mensagem da causa — nunca a causa inteira.
 *
 * Erros de chamadas externas (sgp-client.js, openai-client.js) anexam a
 * causa original em err.cause; antes de saírem daqueles módulos, ela já é
 * saneada para {status, message} — mas console.error em cima do erro inteiro
 * ainda imprimiria a cadeia de causa formatada pelo Node, então quem loga
 * aqui repete a mesma cautela: só {status}/{message}, nunca o objeto cru.
 * Compartilhado entre tool-executor.js e ai-orchestrator.js para não deixar
 * duas versões divergentes da mesma disciplina.
 */
function mensagemSegura(err) {
  const causa = err && err.cause && err.cause.message;
  return `${err && err.message}${causa ? ` (cause: ${causa})` : ''}`;
}

module.exports = { mensagemSegura };
