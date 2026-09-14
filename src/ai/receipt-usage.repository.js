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

// A reserva vale enquanto a liberação estiver de pé. Se a liberação não
// aconteceu (o SGP recusou), o comprovante volta a valer: o cliente não pode
// perder o comprovante dele por causa de uma recusa que não foi dele.
async function releaseReceipt(transactionId) {
  await getPool().query('DELETE FROM ai_receipts_used WHERE transaction_id = $1', [transactionId]);
}

// Quem usou o comprovante antes. Só para o resumo interno: o contrato que sai
// daqui é de OUTRO cliente e nunca pode ser repetido a quem mandou a imagem.
async function findReceiptUsage(transactionId) {
  if (!transactionId) return null;
  const result = await getPool().query(
    'SELECT contact_id, contract_id, used_at FROM ai_receipts_used WHERE transaction_id = $1',
    [transactionId]
  );
  if (result.rowCount === 0) return null;
  const linha = result.rows[0];
  return { contactId: linha.contact_id, contractId: linha.contract_id, usedAt: linha.used_at };
}

module.exports = { claimReceipt, releaseReceipt, findReceiptUsage };
