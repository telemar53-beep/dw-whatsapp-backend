// Envia ao cliente o PIX/boleto de uma fatura em duas mensagens SEMPRE nesta
// ordem: primeiro o "cartão" (valor + vencimento + instrução), depois o
// código puro (PIX copia e cola ou linha digitável) sozinho, para o cliente
// conseguir copiar a mensagem inteira no WhatsApp. A fila de saída processa
// um job por vez em ordem (getOutboundQueue().process sem concorrência), e
// aguardamos cada enqueueOutboundMessage antes do próximo, então a ordem de
// chegada ao cliente é preservada.
const QRCode = require('qrcode');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { saveMediaFile } = require('../media/media-storage');
const { cartaoPix, cartaoPixQr, cartaoBoleto } = require('./payment-card');

async function enviarPix({ conversationId, channelId, fatura, sentBy }) {
  if (!fatura || !fatura.pixCode) throw new Error('Fatura sem código PIX');
  const msgCartao = await enqueueOutboundMessage({
    conversationId, channelId,
    content: cartaoPix({ valor: fatura.value, vencimento: fatura.dueDate }),
    messageType: 'text', sentBy,
  });
  const msgCodigo = await enqueueOutboundMessage({
    conversationId, channelId,
    content: fatura.pixCode,
    messageType: 'text', sentBy,
  });
  return [msgCartao, msgCodigo];
}

async function enviarPixQr({ conversationId, channelId, fatura, sentBy }) {
  if (!fatura || !fatura.pixCode) throw new Error('Fatura sem código PIX');
  // O QR é o mesmo código PIX desenhado como imagem — nunca um código novo.
  const buffer = await QRCode.toBuffer(fatura.pixCode, { type: 'png', width: 512, margin: 2 });
  const mediaPath = await saveMediaFile(buffer, '.png');
  const msgCartaoQr = await enqueueOutboundMessage({
    conversationId, channelId,
    content: cartaoPixQr({ valor: fatura.value, vencimento: fatura.dueDate }),
    messageType: 'image', mediaPath, mediaMimeType: 'image/png', mediaFilename: 'pix.png',
    sentBy,
  });
  const msgCodigo = await enqueueOutboundMessage({
    conversationId, channelId,
    content: fatura.pixCode,
    messageType: 'text', sentBy,
  });
  return [msgCartaoQr, msgCodigo];
}

async function enviarBoleto({ conversationId, channelId, fatura, sentBy }) {
  if (!fatura || !fatura.barCode) throw new Error('Fatura sem linha digitável');
  const msgCartao = await enqueueOutboundMessage({
    conversationId, channelId,
    content: cartaoBoleto({ valor: fatura.value, vencimento: fatura.dueDate }),
    messageType: 'text', sentBy,
  });
  const msgLinha = await enqueueOutboundMessage({
    conversationId, channelId,
    content: fatura.barCode,
    messageType: 'text', sentBy,
  });
  return [msgCartao, msgLinha];
}

module.exports = { enviarPix, enviarPixQr, enviarBoleto };
