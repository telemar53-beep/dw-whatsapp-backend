const { getPool } = require('../db/pool');

// Um comprovante desbloqueia UMA vez. Quem garante isso é a restrição UNIQUE
// de transaction_id, e não uma consulta antes do INSERT: entre o SELECT e o
// INSERT caberia a segunda tentativa. A violação (23505) é a resposta "já foi
// usado" — é o banco decidindo, sem corrida possível.
const VIOLACAO_DE_UNICIDADE = '23505';

async function claimReceipt({ transactionId, contactId, contractId }) {
  try {
    await getPool().query(
      `INSERT INTO ai_receipts_used (transaction_id, contact_id, contract_id) VALUES ($1, $2, $3)`,
      [transactionId, contactId || null, contractId != null ? contractId : null]
    );
    return true;
  } catch (err) {
    if (err && err.code === VIOLACAO_DE_UNICIDADE) return false;
    throw err;
  }
}

module.exports = { claimReceipt };
