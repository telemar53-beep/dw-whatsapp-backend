const { getPool } = require('../db/pool');

const COLUMNS = `id, waba_id, meta_template_id, name, language, category, body_text, variable_count, status, rejection_reason, created_at`;

function toTemplate(row) {
  return {
    id: row.id,
    wabaId: row.waba_id,
    metaTemplateId: row.meta_template_id,
    name: row.name,
    language: row.language,
    category: row.category,
    bodyText: row.body_text,
    variableCount: row.variable_count,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

async function listTemplates() {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM message_templates ORDER BY created_at DESC`);
  return result.rows.map(toTemplate);
}

async function listApprovedTemplatesByWabaId(wabaId) {
  const result = await getPool().query(
    `SELECT ${COLUMNS} FROM message_templates WHERE waba_id = $1 AND status = 'APPROVED' ORDER BY name ASC`,
    [wabaId]
  );
  return result.rows.map(toTemplate);
}

async function findTemplateById(id) {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM message_templates WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}

async function findTemplateByMetaTemplateId(metaTemplateId) {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM message_templates WHERE meta_template_id = $1`, [metaTemplateId]);
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}

async function createTemplateRecord({ wabaId, metaTemplateId, name, language, category, bodyText, variableCount }) {
  const result = await getPool().query(
    `INSERT INTO message_templates (waba_id, meta_template_id, name, language, category, body_text, variable_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [wabaId, metaTemplateId, name, language, category, bodyText, variableCount]
  );
  return toTemplate(result.rows[0]);
}

async function updateTemplateStatusByMetaTemplateId(metaTemplateId, { status, rejectionReason }) {
  const result = await getPool().query(
    `UPDATE message_templates SET status = $2, rejection_reason = $3, updated_at = now()
     WHERE meta_template_id = $1
     RETURNING ${COLUMNS}`,
    [metaTemplateId, status, rejectionReason || null]
  );
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}

async function deleteTemplateRecord(id) {
  const result = await getPool().query('DELETE FROM message_templates WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
};
