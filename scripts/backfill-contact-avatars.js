require('dotenv').config();
const { listContactsMissingAvatarForBaileysBackfill } = require('../src/conversations/contact.repository');
const { findChannelById } = require('../src/channels/channel.repository');
const { startAllBaileysConnections, fetchContactAvatarForChannel } = require('../src/whatsapp-adapters/baileys.manager');
const { closePool } = require('../src/db/pool');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Starting Baileys connections...');
  await startAllBaileysConnections();
  // Give already-authenticated sockets a moment to finish reconnecting before
  // hitting them with profilePictureUrl calls.
  await wait(10000);

  const contacts = await listContactsMissingAvatarForBaileysBackfill();
  console.log(`Found ${contacts.length} contact(s) missing an avatar.`);

  for (const { contactId, phoneNumber, channelId } of contacts) {
    try {
      const channel = await findChannelById(channelId);
      await fetchContactAvatarForChannel(channel, contactId, phoneNumber);
      console.log(`Fetched avatar for contact ${contactId}`);
    } catch (err) {
      console.log(`Skipped contact ${contactId}: ${err.message}`);
    }
    await wait(1000);
  }

  console.log('Backfill complete.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    process.exit(process.exitCode || 0);
  });
