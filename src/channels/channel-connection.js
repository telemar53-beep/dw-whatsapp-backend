const { fetchNumberHealth } = require('../whatsapp-adapters/meta-cloud.adapter');

// O canal oficial nao tem handshake proprio: quem sabe se ele esta de pe e a
// Meta. A tela de Canais pergunta a cada carregamento, entao o resultado fica
// guardado por uma janela curta para nao bater na Graph API a cada F5 e a cada
// admin que abre a pagina.
const CONNECTION_TTL_MS = 60 * 1000;

const cache = new Map();

function traduzir(health) {
  if (!health.ok) {
    // Sem motivo da Meta significa que ela nao respondeu (rede/timeout): nesse
    // caso a tela volta ao selo antigo em vez de acusar um problema que pode
    // nao existir.
    return health.motivo ? { state: 'error', motivo: health.motivo } : { state: 'unknown' };
  }
  if (health.status !== 'CONNECTED') {
    return { state: 'disconnected' };
  }
  return { state: 'connected', quality: health.qualityRating };
}

async function getChannelConnection(channel) {
  if (channel.type !== 'meta_cloud') {
    return null;
  }
  const guardado = cache.get(channel.id);
  if (guardado && Date.now() - guardado.em < CONNECTION_TTL_MS) {
    return guardado.connection;
  }
  const connection = traduzir(await fetchNumberHealth(channel));
  cache.set(channel.id, { em: Date.now(), connection });
  return connection;
}

module.exports = { getChannelConnection, CONNECTION_TTL_MS };
