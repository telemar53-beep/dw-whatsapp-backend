require('dotenv').config();
const { createAgent } = require('../src/agents/agent.repository');
const { closePool } = require('../src/db/pool');

async function main() {
  const [, , email, password, role = 'agent'] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/create-agent.js <email> <password> [role]');
    process.exitCode = 1;
    return;
  }
  const agent = await createAgent({ email, password, role });
  console.log('Agent created:', agent);
}

main()
  .catch((err) => {
    console.error('Failed to create agent:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
