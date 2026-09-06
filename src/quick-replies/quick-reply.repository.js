const { getPool } = require('../db/pool');

function toQuickReply(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listQuickReplies() {
  const result = await getPool().query(
    'SELECT id, title, content, created_at, updated_at FROM quick_replies ORDER BY title ASC'
  );
  return result.rows.map(toQuickReply);
}

async function createQuickReply({ title, content }) {
  const result = await getPool().query(
    `INSERT INTO quick_replies (title, content) VALUES ($1, $2)
     RETURNING id, title, content, created_at, updated_at`,
    [title, content]
  );
  return toQuickReply(result.rows[0]);
}

async function updateQuickReply(id, { title, content }) {
  const result = await getPool().query(
    `UPDATE quick_replies SET title = $2, content = $3, updated_at = now()
     WHERE id = $1
     RETURNING id, title, content, created_at, updated_at`,
    [id, title, content]
  );
  if (result.rowCount === 0) return null;
  return toQuickReply(result.rows[0]);
}

async function deleteQuickReply(id) {
  const result = await getPool().query('DELETE FROM quick_replies WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = { listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply };
