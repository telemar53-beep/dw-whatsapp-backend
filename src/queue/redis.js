const Redis = require('ioredis');
const { loadConfig } = require('../config/env');

let client;

function getRedisClient() {
  if (!client) {
    const config = loadConfig();
    client = new Redis(config.redisUrl);
    client.on('error', (err) => {
      console.error('Unexpected error on Redis client', err);
    });
  }
  return client;
}

async function closeRedisClient() {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

module.exports = { getRedisClient, closeRedisClient };
