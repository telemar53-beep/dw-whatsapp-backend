// Rodada 10 (08/10/2026; ordem, item 1): o PEDIDO DE AÇÃO — se há, agora, um pedido de cobrança do cliente que pode ser
// executado —, separado da identidade (quem fala) e do alvo (de quem é a cobrança, qual contrato). Manter o contrato
// identificado não autoriza executar um pedido que ele cancelou, e o campo `reenviar` do modelo não prova que ele pediu o
// reenvio.
//
// Lido das mensagens GRAVADAS da janela (a mesma que o modelo vê: o histórico recente, em ordem), não de estado em memória:
// sobrevive ao reinício e ao reprocessamento, sem coluna nem marca nova. A fala é classificada pela forma
// (financial-target.js, classificarPedido): o último ato dele sobre a cobrança decide. Puro.
//
// Limites: a fala fora da janela (mais antiga que o histórico recente) não conta; e a leitura é da forma, não do sentido — uma
// desistência fora da lista de marcadores não é vista, e uma frase que cita a cobrança sem pedir ("o boleto não chegou") não é
// pedido (o modelo pergunta, e o "sim" dele à pergunta é).
const { classificarPedido } = require('./financial-target');

/**
 * 'pedido', 'desistencia' ou null: o último ato do cliente sobre a cobrança nestas mensagens (em ordem, `{ de: 'cliente' |
 * 'ia', texto }`). A resposta curta dele ("sim") só é lida com a última fala da IA ANTES dela, se veio depois da fala anterior
 * dele.
 */
function estadoDoPedido(mensagens) {
  let estado = null;
  let falaDaIa = null;
  for (const m of Array.isArray(mensagens) ? mensagens : []) {
    if (!m) continue;
    if (m.de === 'ia') {
      if (m.texto) falaDaIa = m.texto;
      continue;
    }
    if (m.de !== 'cliente') continue;
    const ato = classificarPedido(m.texto, { falaDaIa });
    if (ato) estado = ato;
    falaDaIa = null;
  }
  return estado;
}

/**
 * Há pedido dele, ainda de pé, DEPOIS da mensagem que pediu a entrega anterior? É a condição do reenvio. A mensagem fora da
 * janela (mais antiga): toda a janela veio depois dela.
 */
function pedidoDepoisDe(janela, messageId) {
  const lista = Array.isArray(janela) ? janela : [];
  const i = lista.findIndex((m) => m && String(m.id) === String(messageId));
  return estadoDoPedido(i >= 0 ? lista.slice(i + 1) : lista) === 'pedido';
}

module.exports = { estadoDoPedido, pedidoDepoisDe };
