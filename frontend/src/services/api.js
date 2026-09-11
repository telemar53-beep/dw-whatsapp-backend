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

export function sendMessage(conversationId, content, token, file, repliedToMessageId, isVoiceNote) {
  if (file) {
    const formData = new FormData();
    if (content) {
      formData.append('content', content);
    }
    formData.append('file', file);
    if (isVoiceNote) {
      formData.append('voiceNote', 'true');
    }
    if (repliedToMessageId) {
      formData.append('repliedToMessageId', repliedToMessageId);
    }
    return apiFetch(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: formData, token });
  }
  return apiFetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: repliedToMessageId ? { content, repliedToMessageId } : { content },
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

export function closeConversation(conversationId, reasonId, token) {
  return apiFetch(`/api/conversations/${conversationId}/close`, { method: 'POST', body: { reasonId }, token });
}

export function listAgents(token) {
  return apiFetch('/api/agents', { token });
}

export function listChannels(token, { includeHidden = false } = {}) {
  return apiFetch(`/api/admin/channels${includeHidden ? '?includeHidden=true' : ''}`, { token });
}

export function reconnectChannel(id, token) {
  return apiFetch(`/api/admin/channels/${id}/reconnect`, { method: 'POST', token });
}

export function setChannelHidden(id, hidden, token) {
  return apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: { hidden }, token });
}

export function deleteChannel(id, token) {
  return apiFetch(`/api/admin/channels/${id}`, { method: 'DELETE', token });
}

export function createChannel(payload, token) {
  return apiFetch('/api/admin/channels', { method: 'POST', body: payload, token });
}

export function mediaUrl(messageId, token) {
  return `${API_BASE_URL}/api/media/${messageId}?token=${token}`;
}

export function avatarUrl(contactId, token) {
  return `${API_BASE_URL}/api/contacts/${contactId}/avatar?token=${token}`;
}

export function updateContact(id, payload, token) {
  return apiFetch(`/api/contacts/${id}`, { method: 'PATCH', body: payload, token });
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

export function resetAgentPassword(agentId, token) {
  return apiFetch(`/api/admin/agents/${agentId}/password`, { method: 'PUT', token });
}

export function changePassword(currentPassword, newPassword, token) {
  return apiFetch('/api/auth/password', { method: 'PUT', body: { currentPassword, newPassword }, token });
}

export function listChannelsForAgent(token) {
  return apiFetch('/api/channels', { token });
}

export function getDashboardConversations(token) {
  return apiFetch('/api/admin/dashboard/conversations', { token });
}

export function getDashboardClosedToday({ offset = 0, limit = 20 } = {}, token) {
  return apiFetch(`/api/admin/dashboard/conversations/closed-today?offset=${offset}&limit=${limit}`, { token });
}

export function startConversation({ channelId, phoneNumber, content, templateId, templateVariables }, token) {
  return apiFetch('/api/conversations/start', {
    method: 'POST',
    body: { channelId, phoneNumber, content, templateId, templateVariables },
    token,
  });
}

export function listTemplatesForChannel(channelId, token) {
  return apiFetch(`/api/templates?channelId=${channelId}`, { token });
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

export function setAgentSectors(agentId, sectorIds, token) {
  return apiFetch(`/api/admin/agents/${agentId}/sectors`, { method: 'PUT', body: { sectorIds }, token });
}

export function listReasons(token) {
  return apiFetch('/api/reasons', { token });
}

export function listReasonsAdmin(token) {
  return apiFetch('/api/admin/reasons', { token });
}

export function createReason(payload, token) {
  return apiFetch('/api/admin/reasons', { method: 'POST', body: payload, token });
}

export function updateReason(id, payload, token) {
  return apiFetch(`/api/admin/reasons/${id}`, { method: 'PATCH', body: payload, token });
}

export function getMetrics(period, token, days) {
  const query = period === 'custom' ? `period=${period}&days=${days}` : `period=${period}`;
  return apiFetch(`/api/metrics?${query}`, { token });
}

export function getTriage(token) {
  return apiFetch('/api/admin/triage', { token });
}

export function updateTriageConfig(payload, token) {
  return apiFetch('/api/admin/triage/config', { method: 'PUT', body: payload, token });
}

export function createTriageOption(payload, token) {
  return apiFetch('/api/admin/triage/options', { method: 'POST', body: payload, token });
}

export function updateTriageOption(id, payload, token) {
  return apiFetch(`/api/admin/triage/options/${id}`, { method: 'PATCH', body: payload, token });
}

export function deleteTriageOption(id, token) {
  return apiFetch(`/api/admin/triage/options/${id}`, { method: 'DELETE', token });
}

export function setChannelTriageEnabled(channelId, triageEnabled, token) {
  return apiFetch(`/api/admin/channels/${channelId}`, { method: 'PATCH', body: { triageEnabled }, token });
}

export function setChannelWabaId(id, wabaId, token) {
  return apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: { wabaId }, token });
}

export function setChannelWelcomeMessage(id, welcomeMessage, token) {
  return apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: { welcomeMessage }, token });
}

export function listTemplatesAdmin(token) {
  return apiFetch('/api/admin/templates', { token });
}

export function createTemplateAdmin(data, token) {
  return apiFetch('/api/admin/templates', { method: 'POST', body: data, token });
}

export function deleteTemplateAdmin(id, token) {
  return apiFetch(`/api/admin/templates/${id}`, { method: 'DELETE', token });
}

export function syncTemplatesAdmin(wabaId, token) {
  return apiFetch('/api/admin/templates/sync', { method: 'POST', body: { wabaId }, token });
}

export function registerExistingTemplateAdmin(data, token) {
  return apiFetch('/api/admin/templates/register-existing', { method: 'POST', body: data, token });
}

export function listCities(token) {
  return apiFetch('/api/cities', { token });
}

export function createCity(payload, token) {
  return apiFetch('/api/admin/cities', { method: 'POST', body: payload, token });
}

export function deleteCity(id, token) {
  return apiFetch(`/api/admin/cities/${id}`, { method: 'DELETE', token });
}

export function listCityNotices(token) {
  return apiFetch('/api/admin/cities/notices', { token });
}

export function setCityNotice(cityId, message, enabled, token) {
  return apiFetch(`/api/admin/cities/${cityId}/notice`, { method: 'PATCH', body: { message, enabled }, token });
}

export function deleteCityNotice(cityId, token) {
  return apiFetch(`/api/admin/cities/${cityId}/notice`, { method: 'DELETE', token });
}

export function listSgpIntegrations(token) {
  return apiFetch('/api/admin/integrations/sgp', { token });
}

export function createSgpIntegration(payload, token) {
  return apiFetch('/api/admin/integrations/sgp', { method: 'POST', body: payload, token });
}

export function updateSgpIntegration(id, payload, token) {
  return apiFetch(`/api/admin/integrations/sgp/${id}`, { method: 'PUT', body: payload, token });
}

export function rotateSgpIntegrationKey(id, token) {
  return apiFetch(`/api/admin/integrations/sgp/${id}/rotate-key`, { method: 'POST', token });
}

export function getSgpQueryConfig(token) {
  return apiFetch('/api/admin/integrations/sgp-query-config', { token });
}

export function updateSgpQueryConfig(payload, token) {
  return apiFetch('/api/admin/integrations/sgp-query-config', { method: 'PUT', body: payload, token });
}

export function getAssignmentMessageConfig(token) {
  return apiFetch('/api/admin/assignment-message', { token });
}

export function updateAssignmentMessageConfig(payload, token) {
  return apiFetch('/api/admin/assignment-message', { method: 'PUT', body: payload, token });
}

export function getBusinessHoursConfig(token) {
  return apiFetch('/api/admin/business-hours', { token });
}

export function updateBusinessHoursConfig(payload, token) {
  return apiFetch('/api/admin/business-hours', { method: 'PUT', body: payload, token });
}

export function lookupSgpClient(cpf, token) {
  return apiFetch(`/api/sgp/clientes?cpf=${encodeURIComponent(cpf)}`, { token });
}

export function generateSgpDuplicateInvoice(contratoId, token) {
  return apiFetch(`/api/sgp/contratos/${contratoId}/boleto`, { method: 'POST', token });
}

export function sendSgpBoletoPdf(contratoId, conversationId, boletoLink, token) {
  return apiFetch(`/api/sgp/contratos/${contratoId}/boleto-pdf`, {
    method: 'POST',
    body: { conversationId, boletoLink },
    token,
  });
}

export function getMyProfile(token) {
  return apiFetch('/api/agents/me', { token });
}

export function updateMyProfile({ name, phone }, token) {
  return apiFetch('/api/agents/me', { method: 'PATCH', body: { name, phone }, token });
}

export function uploadMyAvatar(file, token) {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch('/api/agents/me/avatar', { method: 'POST', body: formData, token });
}

export function deleteMyAvatar(token) {
  return apiFetch('/api/agents/me/avatar', { method: 'DELETE', token });
}

export function agentAvatarUrl(agentId, token) {
  return `${API_BASE_URL}/api/agents/${agentId}/avatar?token=${token}`;
}

export function createCampaign(payload, token) {
  return apiFetch('/api/campaigns', { method: 'POST', body: payload, token });
}

export function listCampaigns(token) {
  return apiFetch('/api/campaigns', { token });
}

export function getCampaign(id, token) {
  return apiFetch(`/api/campaigns/${id}`, { token });
}
