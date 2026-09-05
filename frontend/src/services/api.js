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
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

export function claimConversation(conversationId, token) {
  return apiFetch(`/api/conversations/${conversationId}/claim`, { method: 'POST', token });
}

export function sendMessage(conversationId, content, token) {
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
