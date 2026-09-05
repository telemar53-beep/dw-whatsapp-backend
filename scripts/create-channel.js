require('dotenv').config();
const { createChannel } = require('../src/channels/channel.repository');
const { closePool } = require('../src/db/pool');

async function main() {
  const [, , type, name, phoneNumber, phoneNumberId, accessToken] = process.argv;
  if (!type || !name || !phoneNumber) {
    console.error(
      'Usage: node scripts/create-channel.js <type: meta_cloud|baileys> <name> <phoneNumber> [phoneNumberId] [accessToken]'
    );
    process.exitCode = 1;
    return;
  }
  const config = type === 'meta_cloud' ? { phoneNumberId, accessToken } : {};
  const channel = await createChannel({ type, name, phoneNumber, config });
  console.log('Channel created:', channel);
}

main()
  .catch((err) => {
    console.error('Failed to create channel:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
