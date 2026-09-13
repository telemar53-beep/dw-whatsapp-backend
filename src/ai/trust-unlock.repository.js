const { getPool } = require('../db/pool');

// Histórico das liberações em confiança feitas pelo sistema. O SGP instalado
// na DW não expõe a listagem de promessas, então este é o único registro de
// QUANDO cada liberação aconteceu — a regra dos 30 dias e a de promessa
// quebrada (trust-unlock-rules.js) dependem dele.

const COLUMNS = 'id, contact_id, contract_id, protocolo, liberado_dias, created_at';

function toTrustUnlock(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    contractId: row.contract_id,
    protocolo: row.protocolo,
    liberadoDias: row.liberado_dias,
    createdAt: row.created_at,
  };
}

async function recordTrustUnlock({ contactId, contractId, protocolo, liberadoDias }) {
  const result = await getPool().query(
    `INSERT INTO ai_trust_unlocks (contact_id, contract_id, protocolo, liberado_dias)
     VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [contactId || null, contractId, protocolo || null, liberadoDias != null ? liberadoDias : null]
  );
  return toTrustUnlock(result.rows[0]);
}

async function listTrustUnlocksByContract(contractId) {
  const result = await getPool().query(
    `SELECT ${COLUMNS} FROM ai_trust_unlocks WHERE contract_id = $1 ORDER BY created_at DESC`,
    [contractId]
  );
  return result.rows.map(toTrustUnlock);
}

// Houve liberação para ESTE contato na janela pedida? O verificador de
// afirmações (ai-orchestrator.js) usa isto para não desmentir uma liberação
// feita num turno anterior: contexto.desbloqueioRealizado só conhece o turno
// atual. Sem contactId não há o que procurar — uma liberação gravada com
// contact_id nulo não pertence a ninguém e nunca pode casar com "qualquer um".
async function hasRecentTrustUnlockByContact(contactId, withinMs) {
  if (!contactId) return false;
  const result = await getPool().query(
    `SELECT 1 FROM ai_trust_unlocks
     WHERE contact_id = $1 AND created_at > now() - ($2::bigint * interval '1 millisecond')
     LIMIT 1`,
    [contactId, Math.trunc(withinMs)]
  );
  return result.rowCount > 0;
}

module.exports = { recordTrustUnlock, listTrustUnlocksByContract, hasRecentTrustUnlockByContact };
