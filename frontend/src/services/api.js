export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (response.status === 401 && unauthorizedHandler) {
      unauthorizedHandler();
    }
    throw new ApiError(response.status, data);
  }
  return data;
}

export function login(email, password) {
  return apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function getQueue(token) {
  return apiFetch('/api/conversations/queue', { token });
}

export function getMyConversations(token) {
  return apiFetch('/api/conversations/mine', { token });
}

export function getMessages(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/messages`, { token });
}

export function getConversationHistory(contactId, token) {
  return apiFetch(`/api/conversations/contacts/${contactId}/history`, { token });
}

export function claimConversation(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/claim`, { method: 'POST', token });
}

export function sendMessage(conversationId, content, token, file) {
  if (file) {
    const formData = new FormData();
    if (content) {
      formData.append('content', content);
    }
    formData.append('file', file);
    return apiFetch(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: formData, token });
  }
  return apiFetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content },
    token,
  });
}

export function transferConversation(conversationId, toAgentId, token) {
  return apiFetch(`/api/conversations/${conversationId}/transfer`, {
    method: 'POST',
    body: { toAgentId },
    token,
  });
}

export function closeConversation(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/close`, { method: 'POST', token });
}

export function listAgents(token) {
  return apiFetch('/api/agents', { token });
}

export function listChannels(token) {
  return apiFetch('/api/admin/channels', { token });
}

export function createChannel(payload, token) {
  return apiFetch('/api/admin/channels', { method: 'POST', body: payload, token });
}

export function mediaUrl(messageId, token) {
  return `${API_BASE_URL}/api/media/${messageId}?token=${token}`;
}

export function listAgentsAdmin(token) {
  return apiFetch('/api/admin/agents', { token });
}

export function createAgent(payload, token) {
  return apiFetch('/api/admin/agents', { method: 'POST', body: payload, token });
}

export function setAgentActive(agentId, active, token) {
  return apiFetch(`/api/admin/agents/${agentId}`, { method: 'PATCH', body: { active }, token });
}

export function changePassword(currentPassword, newPassword, token) {
  return apiFetch('/api/auth/password', { method: 'PUT', body: { currentPassword, newPassword }, token });
}

export function listChannelsForAgent(token) {
  return apiFetch('/api/channels', { token });
}

export function startConversation({ channelId, phoneNumber, content }, token) {
  return apiFetch('/api/conversations/start', {
    method: 'POST',
    body: { channelId, phoneNumber, content },
    token,
  });
}

export function listQuickReplies(token) {
  return apiFetch('/api/quick-replies', { token });
}

export function createQuickReply(payload, token) {
  return apiFetch('/api/admin/quick-replies', { method: 'POST', body: payload, token });
}

export function updateQuickReply(id, payload, token) {
  return apiFetch(`/api/admin/quick-replies/${id}`, { method: 'PATCH', body: payload, token });
}

export function deleteQuickReply(id, token) {
  return apiFetch(`/api/admin/quick-replies/${id}`, { method: 'DELETE', token });
}

export function listSectors(token) {
  return apiFetch('/api/sectors', { token });
}

export function createSector(payload, token) {
  return apiFetch('/api/admin/sectors', { method: 'POST', body: payload, token });
}

export function updateSector(id, payload, token) {
  return apiFetch(`/api/admin/sectors/${id}`, { method: 'PATCH', body: payload, token });
}

export function deleteSector(id, token) {
  return apiFetch(`/api/admin/sectors/${id}`, { method: 'DELETE', token });
}
