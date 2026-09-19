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
  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim().slice(0, 300);
  }
  if (typeof data === 'string' && data.trim()) {
    return data.trim().slice(0, 300);
  }
  return null;
}

// Códigos da Meta em que tentar de novo dá exatamente o mesmo resultado: a
// recusa é sobre o ESTADO da conversa, não sobre a chamada. Repetir só gasta
// duas chamadas extras à API e atrasa a falha na tela do atendente.
//
// A lista é curta e explícita de propósito, e NUNCA por faixa de código: marcar
// um código como permanente por engano faz uma mensagem que seria entregue ser
// descartada sem nenhuma retentativa - o defeito mais caro dos dois.
//
// 131047 (janela de 24 h fechada): só uma mensagem NOVA do cliente reabre a
// janela, e isso não acontece nos segundos do backoff.
//
// Os outros códigos que o projeto já conhece (frontend/src/utils/failureReasons.js)
// ficaram DE FORA por falta de evidência de que sejam permanentes: 131049
// (limite de marketing) e 131042 (pagamento na conta da Meta) se resolvem
// sozinhos com o tempo, e a própria descrição de 131026 no catálogo admite
// "está indisponível", que é transitório. Só entra aqui código com evidência.
const CODIGOS_PERMANENTES = new Set([131047]);

/**
 * Recebe o corpo inteiro da resposta de erro (err.response.data), igual a
 * motivoDaResposta, e diz se vale a pena o Bull tentar de novo.
 *
 * Lê SÓ data.error.code, o código de erro da Meta. O 360dialog devolve os erros
 * dele próprio em { meta: { http_code } } - http_code é status HTTP, não código
 * da Meta, e comparar um com o outro seria comparar coisas diferentes. Quando o
 * 360dialog repassa um erro da Meta ele vem no formato da Meta e cai aqui igual.
 *
 * Nunca lança: qualquer corpo sem um código conhecido é tratado como
 * transitório, que é o lado seguro (retenta).
 */
function ehErroPermanente(data) {
  if (!data || typeof data !== 'object') return false;
  const { error } = data;
  if (!error || typeof error !== 'object') return false;
  const code = Number(error.code);
  return Number.isFinite(code) && CODIGOS_PERMANENTES.has(code);
}

module.exports = { motivoDaMeta, motivoDaResposta, ehErroPermanente };
