const onlineCounts = new Map();

function markAgentOnline(agentId) {
  const count = onlineCounts.get(agentId) || 0;
  onlineCounts.set(agentId, count + 1);
  return count === 0;
}

function markAgentOffline(agentId) {
  const count = onlineCounts.get(agentId) || 0;
  if (count <= 1) {
    onlineCounts.delete(agentId);
    return count === 1;
  }
  onlineCounts.set(agentId, count - 1);
  return false;
}

function isAgentOnline(agentId) {
  return onlineCounts.has(agentId);
}

function getOnlineAgentIds() {
  return Array.from(onlineCounts.keys());
}

function resetPresence() {
  onlineCounts.clear();
}

module.exports = { markAgentOnline, markAgentOffline, isAgentOnline, getOnlineAgentIds, resetPresence };
