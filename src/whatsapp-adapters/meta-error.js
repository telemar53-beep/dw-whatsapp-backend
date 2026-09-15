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

// motivoDaMeta só entende o formato da Meta ({ error: { code, ... } }); o
// 360dialog (waba-v2.360dialog.io) devolve erros de política/cobrança/permissão
// no formato próprio dele, tipicamente { meta: { success, http_code,
// developer_message } }. Esta função recebe o corpo inteiro da resposta
// (err.response.data) e tenta, em ordem, cada formato conhecido antes de
// desistir - nunca lança, uma resposta sem nenhum campo usável só devolve null.
function motivoDaResposta(data) {
  if (!data) return null;
  if (data.error && typeof data.error === 'object') {
    return motivoDaMeta(data.error);
  }
  if (data.meta && data.meta.developer_message) {
    const { http_code: httpCode, developer_message: developerMessage } = data.meta;
    return httpCode !== undefined && httpCode !== null ? `(${httpCode}) ${developerMessage}` : developerMessage;
  }
  if (typeof data === 'string' && data.trim()) {
    return data.trim().slice(0, 300);
  }
  return null;
}

module.exports = { motivoDaMeta, motivoDaResposta };
