const { getPool } = require('../db/pool');

const COLUMNS = `id, waba_id, meta_template_id, name, language, category, body_text, variable_count, header_type, status, rejection_reason, purpose, created_at`;

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
    headerType: row.header_type,
    status: row.status,
    rejectionReason: row.rejection_reason,
    purpose: row.purpose,
    createdAt: row.created_at,
  };
}

async function listTemplates() {
  const result = await getPool().query(`SELECT ${COLUMNS} FROM message_templates ORDER BY created_at DESC`);
  return result.rows.map(toTemplate);
}

// purpose ausente devolve as duas finalidades — quem chama e que decide qual
// lista quer, e a tela de Templates quer todas.
async function listApprovedTemplatesByWabaId(wabaId, purpose) {
  const result = await getPool().query(
    `SELECT ${COLUMNS} FROM message_templates
     WHERE waba_id = $1 AND status = 'APPROVED' AND ($2::text IS NULL OR purpose = $2)
     ORDER BY name ASC`,
    [wabaId, purpose || null]
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

async function findTemplateByNameAndWaba(name, wabaId) {
  const result = await getPool().query(
    `SELECT ${COLUMNS} FROM message_templates WHERE name = $1 AND waba_id = $2 ORDER BY created_at ASC LIMIT 1`,
    [name, wabaId]
  );
  if (result.rowCount === 0) return null;
  return toTemplate(result.rows[0]);
}

async function createTemplateRecord({ wabaId, metaTemplateId, name, language, category, bodyText, variableCount, headerType, purpose }) {
  const result = await getPool().query(
    `INSERT INTO message_templates (waba_id, meta_template_id, name, language, category, body_text, variable_count, header_type, purpose)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'atendimento'))
     RETURNING ${COLUMNS}`,
    [wabaId, metaTemplateId, name, language, category, bodyText, variableCount, headerType || null, purpose || null]
  );
  return toTemplate(result.rows[0]);
}

// Trocar a finalidade de um template que ja existe: o SGP e a campanha usam os
// mesmos templates da Meta, e so aqui o sistema sabe para que serve cada um.
async function updateTemplatePurpose(id, purpose) {
  const result = await getPool().query(
    `UPDATE message_templates SET purpose = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, purpose]
  );
  if (result.rowCount === 0) return null;
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
  findTemplateByNameAndWaba,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  updateTemplatePurpose,
  deleteTemplateRecord,
};
