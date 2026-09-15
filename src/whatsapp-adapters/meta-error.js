/**
 * Reduz o objeto de erro que a Meta manda a uma linha só, em português quando
 * a própria Meta já manda uma mensagem amigável (error_user_msg), senão o
 * texto técnico disponível. Usado em dois pontos: no catch do envio (o corpo
 * de err.response.data.error) e no webhook de status (statuses[].errors[0]) -
 * o mesmo formato { code, title, message, error_user_msg, error_data: { details } }
 * nos dois casos.
 *
 * É este texto que fica gravado em messages.metadata.motivoFalha e que o
 * atendente lê sob o balão de uma mensagem não entregue. Nunca lança: um
 * objeto de erro ausente ou sem nenhum campo usável só devolve null.
 */
function motivoDaMeta(error) {
  if (!error) return null;
  const { code, title, message, error_user_msg: errorUserMsg, error_data: errorData } = error;
  const texto = errorUserMsg || (errorData && errorData.details) || title || message;
  if (!texto) return null;
  return code !== undefined && code !== null ? `(${code}) ${texto}` : texto;
}

module.exports = { motivoDaMeta };
