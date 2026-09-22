const express = require('express');
const { autenticarLeituraDeMidia } = require('../auth/media-auth.middleware');
const { findMessageById } = require('../conversations/message.repository');
const { findConversationStatusById } = require('../conversations/conversation.repository');
const { getMediaFilePath } = require('../media/media-storage');

const router = express.Router();

router.get('/:messageId', autenticarLeituraDeMidia, async (req, res) => {
  const message = await findMessageById(req.params.messageId);
  if (!message || !message.mediaPath) {
    return res.status(404).json({ error: 'Media not found' });
  }
  // Mesma regra da leitura de mensagens: midia de disparo ainda nao respondido
  // nao sai para atendente. A consulta e um SELECT de uma coluna por chave
  // primaria, e so acontece para quem nao e administrativo - esta rota e
  // chamada uma vez por bolha de audio/video, por causa do preload do player.
  if (!req.leitorDeMidia.podeVerSilent) {
    const status = await findConversationStatusById(message.conversationId);
    if (status === 'silent') {
      return res.status(403).json({ error: 'This conversation is not available until the customer replies' });
    }
  }
  if (message.mediaMimeType) {
    res.type(message.mediaMimeType);
  }
  if (message.messageType === 'document' && message.mediaFilename) {
    res.setHeader('Content-Disposition', `attachment; filename="${message.mediaFilename.replace(/"/g, '')}"`);
  }
  res.sendFile(getMediaFilePath(message.mediaPath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Media not found' });
    }
  });
});

module.exports = router;
