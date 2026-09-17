const { processMediaRetentionQueue, scheduleMediaRetention } = require('./media-retention-queue');
const { listExpiredMedia, clearMessageMedia } = require('../conversations/message.repository');
const { deleteMediaFile } = require('../media/media-storage');
const { mensagemSegura } = require('../ai/safe-error-log');

// Doze meses, decidido pelo dono. O arquivo sai; a MENSAGEM fica — a bolha, a
// legenda e o tipo permanecem no histórico do atendimento.
const RETENTION_MONTHS = 12;
// Em lotes: a primeira varredura pode encontrar um ano inteiro de arquivos, e
// carregar tudo de uma vez numa lista só é o tipo de coisa que derruba o
// processo justamente quando ele mais importa.
const BATCH_SIZE = 500;

async function handleMediaRetentionJob() {
  let removidos = 0;
  try {
    for (;;) {
      const vencidos = await listExpiredMedia({ olderThanMonths: RETENTION_MONTHS, limit: BATCH_SIZE });
      if (vencidos.length === 0) break;

      for (const midia of vencidos) {
        // O arquivo sai primeiro, a referência depois. Na ordem inversa, uma
        // falha no meio deixaria o arquivo órfão no disco — invisível e para
        // sempre, que é exatamente o problema que estamos resolvendo.
        try {
          await deleteMediaFile(midia.mediaPath);
        } catch (err) {
          // Arquivo que já não existe (removido à mão, restore de backup) não
          // pode impedir a limpeza: senão ele volta em toda varredura.
          console.warn(`Retenção: não foi possível apagar o arquivo da mensagem ${midia.id}: ${mensagemSegura(err)}`);
        }
        await clearMessageMedia(midia.id);
        removidos += 1;
      }
      if (vencidos.length < BATCH_SIZE) break;
    }
    if (removidos > 0) console.log(`Retenção de mídia: ${removidos} arquivo(s) com mais de ${RETENTION_MONTHS} meses removidos.`);
  } catch (err) {
    // Nunca lança: a limpeza tenta de novo na semana seguinte, e derrubar o
    // worker custaria mais do que o disco que ela economiza.
    console.error(`Retenção de mídia falhou: ${mensagemSegura(err)}`);
  }
  return { removidos };
}

function startMediaRetentionWorker() {
  processMediaRetentionQueue(handleMediaRetentionJob);
  scheduleMediaRetention().catch((err) => {
    console.error(`Não foi possível agendar a retenção de mídia: ${mensagemSegura(err)}`);
  });
}

module.exports = { handleMediaRetentionJob, startMediaRetentionWorker, RETENTION_MONTHS };
