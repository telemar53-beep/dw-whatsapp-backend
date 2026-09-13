// Envia ao cliente o PIX/boleto de uma fatura. O QR e o boleto vão em duas
// mensagens SEMPRE nesta ordem: primeiro o "cartão" (valor + vencimento +
// instrução), depois o código puro (PIX copia e cola ou linha digitável)
// sozinho, para o cliente conseguir copiar a mensagem inteira no WhatsApp. A
// fila de saída processa um job por vez em ordem (getOutboundQueue().process
// sem concorrência), e aguardamos cada enqueueOutboundMessage antes do
// próximo, então a ordem de chegada ao cliente é preservada.
//
// O PIX simples (enviarPix) é a exceção: vira UMA mensagem do tipo 'pix', com
// o copia e cola no content e valor/vencimento/fatura na metadata. Quem decide
// entre o cartão nativo do WhatsApp e o par de textos de sempre é o worker de
// saída, na hora do envio — só lá se sabe o canal e se há recebedor
// cadastrado. Enfileirar duas mensagens aqui tiraria essa escolha dele.
const QRCode = require('qrcode');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { saveMediaFile } = require('../media/media-storage');
const { cartaoPixQr, cartaoBoleto } = require('./payment-card');

async function enviarPix({ conversationId, channelId, fatura, sentBy }) {
  if (!fatura || !fatura.pixCode) throw new Error('Fatura sem código PIX');
  const msg = await enqueueOutboundMessage({
    conversationId, channelId,
    content: fatura.pixCode,
    messageType: 'pix',
    metadata: { value: fatura.value, dueDate: fatura.dueDate, faturaId: fatura.id || null },
    sentBy,
  });
  return [msg];
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
