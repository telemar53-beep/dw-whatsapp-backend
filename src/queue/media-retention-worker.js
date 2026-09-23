const { processMediaRetentionQueue, scheduleMediaRetention } = require('./media-retention-queue');
const { listExpiredMedia, clearMessageMedia } = require('../conversations/message.repository');
const { deleteMediaFile } = require('../media/media-storage');
const { mensagemSegura } = require('../ai/safe-error-log');
const { loadConfig } = require('../config/env');

// Noventa dias por padrão, decidido pelo dono em 23/09/2026. Eram doze MESES, e
// doze meses era política INERTE: com o disco enchendo em semanas, ela não
// chegava a apagar o primeiro arquivo antes de o espaço acabar. Atendimento se
// resolve em dias.
//
// O arquivo sai; a MENSAGEM fica — a bolha, a legenda e o tipo permanecem no
// histórico do atendimento.
//
// Configurável por `MEDIA_RETENTION_DAYS` porque este número é o que dimensiona
// o disco em regime (disco ≈ ritmo diário × dias de retenção): ele vai precisar
// de ajuste conforme o volume real, e por provedor. Em variável de ambiente,
// ajustar não vira deploy de código. A sanitização mora em config/env.js.
//
// Lido a cada varredura, e não uma vez no carregamento do módulo: trocar a
// variável passa a valer na semana seguinte, sem depender de o processo ter
// reiniciado no momento certo.
function diasDeRetencao() {
  return loadConfig().mediaRetentionDays;
}

// Em lotes: a primeira varredura pode encontrar um ano inteiro de arquivos, e
// carregar tudo de uma vez numa lista só é o tipo de coisa que derruba o
// processo justamente quando ele mais importa.
const BATCH_SIZE = 500;

async function handleMediaRetentionJob() {
  let removidos = 0;
  const dias = diasDeRetencao();
  try {
    for (;;) {
      const vencidos = await listExpiredMedia({ olderThanDays: dias, limit: BATCH_SIZE });
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
    if (removidos > 0) console.log(`Retenção de mídia: ${removidos} arquivo(s) com mais de ${dias} dias removidos.`);
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

module.exports = { handleMediaRetentionJob, startMediaRetentionWorker, diasDeRetencao };
