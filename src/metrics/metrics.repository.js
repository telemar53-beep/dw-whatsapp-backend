const { getPool } = require('../db/pool');

function toNumberOrNull(value) {
  return value === null ? null : Math.round(Number(value) * 10) / 10;
}

async function getMetricsForAgent(agentId, since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.conversation_id, ce.created_at AS closed_at, c.created_at AS started_at
       FROM conversation_events ce
       JOIN conversations c ON c.id = ce.conversation_id
       WHERE ce.event_type = 'closed' AND ce.from_agent_id = $1 AND ce.created_at >= $2
     ),
     first_assigned AS (
       SELECT conversation_id, MIN(created_at) AS assigned_at
       FROM conversation_events
       WHERE event_type IN ('assigned', 'transferred') AND conversation_id IN (SELECT conversation_id FROM closed)
       GROUP BY conversation_id
     ),
     first_response AS (
       SELECT m.conversation_id, MIN(m.created_at) AS first_response_at
       FROM messages m
       JOIN first_assigned fa ON fa.conversation_id = m.conversation_id
       WHERE m.direction = 'outbound' AND m.created_at >= fa.assigned_at
       GROUP BY m.conversation_id
     )
     SELECT
       COUNT(*)::int AS closed_count,
       AVG(EXTRACT(EPOCH FROM (closed.closed_at - closed.started_at)) / 60) AS avg_resolution_minutes,
       AVG(EXTRACT(EPOCH FROM (first_response.first_response_at - closed.started_at)) / 60) AS avg_first_response_minutes
     FROM closed
     LEFT JOIN first_response ON first_response.conversation_id = closed.conversation_id`,
    [agentId, since]
  );
  const row = result.rows[0];
  return {
    closedCount: Number(row.closed_count),
    avgResolutionMinutes: toNumberOrNull(row.avg_resolution_minutes),
    avgFirstResponseMinutes: toNumberOrNull(row.avg_first_response_minutes),
  };
}

async function getMetricsForAllAgents(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.conversation_id, ce.from_agent_id AS agent_id, ce.created_at AS closed_at, c.created_at AS started_at
       FROM conversation_events ce
       JOIN conversations c ON c.id = ce.conversation_id
       WHERE ce.event_type = 'closed' AND ce.from_agent_id IS NOT NULL AND ce.created_at >= $1
     ),
     first_assigned AS (
       SELECT conversation_id, MIN(created_at) AS assigned_at
       FROM conversation_events
       WHERE event_type IN ('assigned', 'transferred') AND conversation_id IN (SELECT conversation_id FROM closed)
       GROUP BY conversation_id
     ),
     first_response AS (
       SELECT m.conversation_id, MIN(m.created_at) AS first_response_at
       FROM messages m
       JOIN first_assigned fa ON fa.conversation_id = m.conversation_id
       WHERE m.direction = 'outbound' AND m.created_at >= fa.assigned_at
       GROUP BY m.conversation_id
     )
     SELECT
       closed.agent_id,
       a.name AS agent_name,
       COUNT(*)::int AS closed_count,
       AVG(EXTRACT(EPOCH FROM (closed.closed_at - closed.started_at)) / 60) AS avg_resolution_minutes,
       AVG(EXTRACT(EPOCH FROM (first_response.first_response_at - closed.started_at)) / 60) AS avg_first_response_minutes
     FROM closed
     JOIN agents a ON a.id = closed.agent_id
     LEFT JOIN first_response ON first_response.conversation_id = closed.conversation_id
     GROUP BY closed.agent_id, a.name
     ORDER BY a.name ASC`,
    [since]
  );
  return result.rows.map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    closedCount: Number(row.closed_count),
    avgResolutionMinutes: toNumberOrNull(row.avg_resolution_minutes),
    avgFirstResponseMinutes: toNumberOrNull(row.avg_first_response_minutes),
  }));
}

// Agrupa pelo setor da CONVERSA, não pelos setores do atendente: antes, atendente sem setor
// sumia do gráfico e atendente em dois setores contava duas vezes. NULL vira a barra
// 'Sem setor' — nenhum setor é atribuído retroativamente.
async function getMetricsBySector(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT c.sector_id
       FROM conversation_events ce
       JOIN conversations c ON c.id = ce.conversation_id
       JOIN agents a ON a.id = ce.from_agent_id
       WHERE ce.event_type = 'closed' AND ce.from_agent_id IS NOT NULL AND ce.created_at >= $1
     )
     SELECT closed.sector_id, COALESCE(s.name, 'Sem setor') AS sector_name, COUNT(*)::int AS closed_count
     FROM closed
     LEFT JOIN sectors s ON s.id = closed.sector_id
     GROUP BY closed.sector_id, s.name
     ORDER BY (closed.sector_id IS NULL) ASC, s.name ASC`,
    [since]
  );
  return result.rows.map((row) => ({
    sectorId: row.sector_id,
    sectorName: row.sector_name,
    closedCount: Number(row.closed_count),
  }));
}

async function getMetricsByReason(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.reason_id
       FROM conversation_events ce
       WHERE ce.event_type = 'closed' AND ce.created_at >= $1
     )
     SELECT closed.reason_id, COALESCE(r.name, 'Sem motivo') AS reason_name, COUNT(*)::int AS closed_count
     FROM closed
     LEFT JOIN contact_reasons r ON r.id = closed.reason_id
     GROUP BY closed.reason_id, r.name
     ORDER BY (closed.reason_id IS NULL) ASC, closed_count DESC, r.name ASC`,
    [since]
  );
  return result.rows.map((row) => ({
    reasonId: row.reason_id,
    reasonName: row.reason_name,
    closedCount: Number(row.closed_count),
  }));
}

module.exports = { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector, getMetricsByReason };
