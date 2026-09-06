const { getPool } = require('../db/pool');

function toTriageConfig(row) {
  return {
    questionText: row.question_text,
    confirmationText: row.confirmation_text,
    maxAttempts: row.max_attempts,
  };
}

function toTriageOption(row) {
  return {
    id: row.id,
    optionNumber: row.option_number,
    sectorId: row.sector_id,
    sectorName: row.sector_name,
    keywords: row.keywords,
  };
}

async function getTriageConfig() {
  const result = await getPool().query(
    'SELECT question_text, confirmation_text, max_attempts FROM triage_config WHERE id = 1'
  );
  return toTriageConfig(result.rows[0]);
}

async function updateTriageConfig({ questionText, confirmationText, maxAttempts }) {
  const result = await getPool().query(
    `UPDATE triage_config SET question_text = $1, confirmation_text = $2, max_attempts = $3, updated_at = now()
     WHERE id = 1
     RETURNING question_text, confirmation_text, max_attempts`,
    [questionText, confirmationText, maxAttempts]
  );
  return toTriageConfig(result.rows[0]);
}

async function listTriageOptions() {
  const result = await getPool().query(
    `SELECT o.id, o.option_number, o.sector_id, o.keywords, s.name AS sector_name
     FROM triage_options o
     JOIN sectors s ON s.id = o.sector_id
     ORDER BY o.option_number ASC`
  );
  return result.rows.map(toTriageOption);
}

async function findTriageOptionById(id) {
  const result = await getPool().query(
    `SELECT o.id, o.option_number, o.sector_id, o.keywords, s.name AS sector_name
     FROM triage_options o
     JOIN sectors s ON s.id = o.sector_id
     WHERE o.id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return toTriageOption(result.rows[0]);
}

async function createTriageOption({ optionNumber, sectorId, keywords }) {
  const insertResult = await getPool().query(
    'INSERT INTO triage_options (option_number, sector_id, keywords) VALUES ($1, $2, $3) RETURNING id',
    [optionNumber, sectorId, keywords]
  );
  return findTriageOptionById(insertResult.rows[0].id);
}

async function updateTriageOption(id, { optionNumber, sectorId, keywords }) {
  const result = await getPool().query(
    `UPDATE triage_options SET option_number = $2, sector_id = $3, keywords = $4
     WHERE id = $1
     RETURNING id`,
    [id, optionNumber, sectorId, keywords]
  );
  if (result.rowCount === 0) return null;
  return findTriageOptionById(id);
}

async function deleteTriageOption(id) {
  const result = await getPool().query('DELETE FROM triage_options WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
};
