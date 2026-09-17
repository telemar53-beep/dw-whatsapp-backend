const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

// Uma vez por semana, às 2h da manhã no horário de São Paulo: é quando ninguém
// está atendendo, e apagar arquivo é trabalho de disco que não deve disputar
// espaço com o atendimento.
//
// O fuso é explícito porque o servidor roda em UTC — sem isso, "2h" seriam 23h
// de São Paulo, em plena madrugada de atendimento noturno da IA.
const RETENTION_CRON = '0 2 * * 0';
const RETENTION_TIMEZONE = 'America/Sao_Paulo';

function getMediaRetentionQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('media-retention', config.redisUrl);
  }
  return queue;
}

/**
 * Job repetível com jobId fixo: um deploy novo não acumula um agendamento a
 * cada reinício do processo. O Bull substitui o repetível de mesmo id.
 */
async function scheduleMediaRetention() {
  await getMediaRetentionQueue().add(
    {},
    {
      jobId: 'media-retention-weekly',
      repeat: { cron: RETENTION_CRON, tz: RETENTION_TIMEZONE },
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

function processMediaRetentionQueue(handler) {
  getMediaRetentionQueue().process(async () => handler());
}

async function closeMediaRetentionQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = {
  getMediaRetentionQueue,
  scheduleMediaRetention,
  processMediaRetentionQueue,
  closeMediaRetentionQueue,
  RETENTION_CRON,
  RETENTION_TIMEZONE,
};
