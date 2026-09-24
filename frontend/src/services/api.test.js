import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  apiFetch,
  ApiError,
  login,
  getQueue,
  setUnauthorizedHandler,
  sendMessage,
  closeConversation,
  mediaUrl,
  fetchChannelQrImage,
  listAgentsAdmin,
  createAgent,
  setAgentActive,
  changePassword,
  getConversationHistory,
  listChannelsForAgent,
  startConversation,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  listSectors,
  createSector,
  updateSector,
  deleteSector,
  setAgentSectors,
  listReasons,
  listReasonsAdmin,
  createReason,
  updateReason,
  getMetrics,
  getTriage,
  updateTriageConfig,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
  setChannelTriageEnabled,
  getMyProfile,
  updateMyProfile,
  uploadMyAvatar,
  deleteMyAvatar,
  agentAvatarUrl,
  createCampaign,
  listCampaigns,
  getCampaign,
} from './api';

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('apiFetch', () => {
  test('sends the Authorization header when a token is provided', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ hello: 'world' })),
    });

    const result = await apiFetch('/api/conversations/queue', { token: 'tok-123' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/queue',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      })
    );
    expect(result).toEqual({ hello: 'world' });
  });

  test('sends a JSON body for POST requests', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });

    await apiFetch('/api/conversations/abc/claim', { method: 'POST', token: 'tok-123' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/abc/claim',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('throws ApiError with status and body on a non-2xx response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      text: () => Promise.resolve(JSON.stringify({ error: 'Already assigned' })),
    });

    await expect(apiFetch('/api/conversations/abc/claim', { method: 'POST' })).rejects.toMatchObject({
      status: 409,
      body: { error: 'Already assigned' },
    });
  });

  test('returns null when the response body is empty', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    const result = await apiFetch('/health');
    expect(result).toBeNull();
  });

  test('sends a FormData body as-is, without a Content-Type header or JSON.stringify', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    const formData = new FormData();
    formData.append('content', 'Legenda');

    await apiFetch('/api/conversations/abc/messages', { method: 'POST', body: formData, token: 'tok-123' });

    const callArgs = global.fetch.mock.calls[0][1];
    expect(callArgs.body).toBe(formData);
    expect(callArgs.headers['Content-Type']).toBeUndefined();
    expect(callArgs.headers.Authorization).toBe('Bearer tok-123');
  });
});

describe('login', () => {
  test('posts credentials to /api/auth/login', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ token: 'tok', agent: { id: 'a1', role: 'agent' } })),
    });

    const result = await login('a@dw.com', 'secret123');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@dw.com', password: 'secret123' }),
      })
    );
    expect(result).toEqual({ token: 'tok', agent: { id: 'a1', role: 'agent' } });
  });
});

describe('getQueue', () => {
  test('fetches the waiting queue with the given token', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await getQueue('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/queue',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }) })
    );
  });
});

describe('apiFetch 401 handling', () => {
  test('calls the registered unauthorized handler on a 401 response', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    global.fetch.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('{}') });

    await expect(apiFetch('/api/conversations/queue', { token: 'expired' })).rejects.toMatchObject({ status: 401 });

    expect(handler).toHaveBeenCalled();
    setUnauthorizedHandler(null);
  });

  test('does not throw when no handler is registered', async () => {
    setUnauthorizedHandler(null);
    global.fetch.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('{}') });
    await expect(apiFetch('/api/conversations/queue')).rejects.toMatchObject({ status: 401 });
  });

  // PRF-12: errar a senha atual na troca de senha DESLOGAVA. O backend responde
  // 401 "Current password is incorrect" (src/auth/auth.routes.js:38), e todo 401
  // era tratado como sessão expirada. Só 401 de SESSÃO desloga nessa chamada.
  const resposta401 = (corpo) => ({ ok: false, status: 401, text: () => Promise.resolve(corpo) });

  test('troca de senha com a senha atual errada NÃO desloga', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    global.fetch.mockResolvedValue(resposta401('{"error":"Current password is incorrect"}'));

    await expect(changePassword('errada', 'nova12345', 'tok-123')).rejects.toMatchObject({
      status: 401,
      body: { error: 'Current password is incorrect' },
    });

    expect(handler).not.toHaveBeenCalled();
    setUnauthorizedHandler(null);
  });

  test.each(['Invalid or expired token', 'Missing authorization token'])(
    'troca de senha com a sessão inválida ("%s") continua deslogando',
    async (frase) => {
      const handler = vi.fn();
      setUnauthorizedHandler(handler);
      global.fetch.mockResolvedValue(resposta401(JSON.stringify({ error: frase })));

      await expect(changePassword('atual', 'nova12345', 'tok-velho')).rejects.toMatchObject({ status: 401 });

      expect(handler).toHaveBeenCalledTimes(1);
      setUnauthorizedHandler(null);
    }
  );

  test('troca de senha com 401 sem corpo desloga (na dúvida, é sessão)', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    global.fetch.mockResolvedValue(resposta401(''));

    await expect(changePassword('atual', 'nova12345', 'tok-123')).rejects.toMatchObject({ status: 401 });

    expect(handler).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });

  test('fora da troca de senha, todo 401 continua deslogando — inclusive com frase de credencial', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    global.fetch.mockResolvedValue(resposta401('{"error":"Current password is incorrect"}'));

    await expect(apiFetch('/api/conversations/queue', { token: 'tok-123' })).rejects.toMatchObject({ status: 401 });

    expect(handler).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });
});

describe('ApiError', () => {
  test('carries status and body', () => {
    const err = new ApiError(404, { error: 'Not found' });
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: 'Not found' });
    expect(err.message).toBe('Not found');
  });
});

describe('mediaUrl', () => {
  test('usa o token de midia quando ele existe', () => {
    expect(mediaUrl('msg-123', 'media-abc')).toBe('http://localhost:3000/api/media/msg-123?mediaToken=media-abc');
  });


  test('nao existe mais caminho para o JWT de sessao entrar na URL', () => {
    // A funcao nem aceita mais um segundo token: o unico argumento de
    // credencial e o mediaToken.
    expect(mediaUrl.length).toBe(2);
    expect(mediaUrl('msg-123', 'media-abc')).not.toMatch(/[?&]token=/);
  });
});

describe('listAgentsAdmin', () => {
  test('fetches the admin agent list', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listAgentsAdmin('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/agents',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('createAgent', () => {
  test('posts the new agent payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createAgent({ name: 'Ana', email: 'ana@dw.com', password: 'temp123', role: 'agent' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/agents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Ana', email: 'ana@dw.com', password: 'temp123', role: 'agent' }),
      })
    );
  });
});

describe('setAgentActive', () => {
  test('patches the agent active flag', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await setAgentActive('agent-1', false, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/agents/agent-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) })
    );
  });
});

describe('closeConversation', () => {
  test('posts the reasonId in the body', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await closeConversation('conv-1', 'reason-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/conv-1/close',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ reasonId: 'reason-1' }) })
    );
  });
});

describe('getConversationHistory', () => {
  test('fetches the closed conversation history for a contact', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await getConversationHistory('contact-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/contacts/contact-1/history',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('changePassword', () => {
  test('puts the current and new password', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await changePassword('oldpass', 'newpass', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/password',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ currentPassword: 'oldpass', newPassword: 'newpass' }),
      })
    );
  });
});

describe('listChannelsForAgent', () => {
  test('fetches the channel list for any authenticated agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listChannelsForAgent('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/channels',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('startConversation', () => {
  test('posts the new conversation payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await startConversation({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/conversations/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' }),
      })
    );
  });
});

describe('listQuickReplies', () => {
  test('fetches the quick reply list for any authenticated agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listQuickReplies('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/quick-replies',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('createQuickReply', () => {
  test('posts the new quick reply payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createQuickReply({ title: 'Boas-vindas', content: 'Olá!' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/quick-replies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Boas-vindas', content: 'Olá!' }),
      })
    );
  });
});

describe('updateQuickReply', () => {
  test('patches the quick reply payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateQuickReply('qr-1', { title: 'Editado', content: 'Texto editado' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/quick-replies/qr-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Editado', content: 'Texto editado' }),
      })
    );
  });
});

describe('deleteQuickReply', () => {
  test('sends a DELETE request for the quick reply', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    await deleteQuickReply('qr-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/quick-replies/qr-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('listSectors', () => {
  test('fetches the sector list for any authenticated agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listSectors('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sectors',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('createSector', () => {
  test('posts the new sector payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createSector({ name: 'Financeiro' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/sectors',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Financeiro' }) })
    );
  });
});

describe('updateSector', () => {
  test('patches the sector payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateSector('sector-1', { name: 'Editado' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/sectors/sector-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Editado' }) })
    );
  });
});

describe('deleteSector', () => {
  test('sends a DELETE request for the sector', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    await deleteSector('sector-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/sectors/sector-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('setAgentSectors', () => {
  test('puts the sector ids for an agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await setAgentSectors('agent-1', ['sector-1', 'sector-2'], 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/agents/agent-1/sectors',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ sectorIds: ['sector-1', 'sector-2'] }) })
    );
  });
});

describe('listReasons', () => {
  test('fetches the active reason list for any authenticated agent', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listReasons('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/reasons',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('listReasonsAdmin', () => {
  test('fetches all reasons for an admin', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listReasonsAdmin('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/reasons',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('createReason', () => {
  test('posts the new reason payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createReason({ name: 'Troca de senha' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/reasons',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Troca de senha' }) })
    );
  });
});

describe('updateReason', () => {
  test('patches the reason payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateReason('reason-1', { active: false }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/reasons/reason-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) })
    );
  });
});

describe('getMetrics', () => {
  test('fetches metrics for the given period', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await getMetrics('7d', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/metrics?period=7d',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('getTriage', () => {
  test('fetches the triage configuration and options', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await getTriage('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('updateTriageConfig', () => {
  test('puts the triage config payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateTriageConfig({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/config',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 }),
      })
    );
  });
});

describe('createTriageOption', () => {
  test('posts the new triage option payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await createTriageOption({ optionNumber: 1, sectorId: 'sector-1', keywords: ['fatura'] }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/options',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ optionNumber: 1, sectorId: 'sector-1', keywords: ['fatura'] }),
      })
    );
  });
});

describe('updateTriageOption', () => {
  test('patches the triage option payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateTriageOption('opt-1', { optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/options/opt-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] }),
      })
    );
  });
});

describe('deleteTriageOption', () => {
  test('sends a DELETE request for the triage option', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    await deleteTriageOption('opt-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/triage/options/opt-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('setChannelTriageEnabled', () => {
  test('patches the channel triageEnabled flag', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await setChannelTriageEnabled('channel-1', true, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/admin/channels/channel-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ triageEnabled: true }) })
    );
  });
});

describe('getMyProfile', () => {
  test('fetches the authenticated agent\'s own profile', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await getMyProfile('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/agents/me',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('updateMyProfile', () => {
  test('patches the name and phone', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await updateMyProfile({ name: 'Ana Paula', phone: '11988887777' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/agents/me',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Ana Paula', phone: '11988887777' }),
      })
    );
  });
});

describe('uploadMyAvatar', () => {
  test('posts the file as multipart form data', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    const file = new File(['fake-bytes'], 'foto.jpg', { type: 'image/jpeg' });

    await uploadMyAvatar(file, 'tok-123');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/agents/me/avatar',
      expect.objectContaining({ method: 'POST' })
    );
    const call = global.fetch.mock.calls[0];
    const options = call[1];
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('file')).toBe(file);
  });
});

describe('deleteMyAvatar', () => {
  test('sends a DELETE request to remove the avatar', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await deleteMyAvatar('tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/agents/me/avatar',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('agentAvatarUrl', () => {
  test('usa o token de midia quando ele existe', () => {
    expect(agentAvatarUrl('agent-1', 'media-abc')).toBe('http://localhost:3000/api/agents/agent-1/avatar?mediaToken=media-abc');
  });

});

describe('createCampaign', () => {
  test('posts the campaign payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{"id":"campaign-1"}') });
    await createCampaign({ channelId: 'ch-1', content: 'Oi', recipients: '5511999990000' }, 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/campaigns',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channelId: 'ch-1', content: 'Oi', recipients: '5511999990000' }),
      })
    );
  });
});

describe('listCampaigns', () => {
  test('fetches the campaign list', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('[]') });
    await listCampaigns('tok-123');
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/campaigns', expect.objectContaining({ method: 'GET' }));
  });
});

describe('getCampaign', () => {
  test('fetches one campaign by id', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await getCampaign('campaign-1', 'tok-123');
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/campaigns/campaign-1', expect.objectContaining({ method: 'GET' }));
  });
});

// A tela do QR lia um DOCUMENTO HTML e pescava o primeiro `<img src>` com
// DOMParser: mexer no template do backend - ate no CSS - quebrava a tela sem
// quebrar teste nenhum, porque essa funcao nao tinha teste. Agora ela pede
// JSON pelo Accept e le um campo.
describe('fetchChannelQrImage', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  function responder({ status = 200, corpo = {} } = {}) {
    global.fetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(corpo),
      text: () => Promise.resolve(JSON.stringify(corpo)),
    });
  }

  test('pede JSON e manda o token no header, nunca na URL', async () => {
    responder({ corpo: { image: 'data:image/png;base64,AAAA', channelId: 'c1', channelName: 'Vendas' } });

    await fetchChannelQrImage('c1', 'tok-123');

    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/admin/channels/c1/qr');
    expect(url).not.toContain('token');
    expect(opcoes.headers.Authorization).toBe('Bearer tok-123');
    expect(opcoes.headers.Accept).toBe('application/json');
  });

  test('devolve o data URI do campo image', async () => {
    responder({ corpo: { image: 'data:image/png;base64,AAAA', channelId: 'c1', channelName: 'Vendas' } });

    await expect(fetchChannelQrImage('c1', 'tok-123')).resolves.toBe('data:image/png;base64,AAAA');
  });

  test('404 vira motivo indisponivel', async () => {
    responder({ status: 404, corpo: { error: 'No QR code available for this channel' } });

    await expect(fetchChannelQrImage('c1', 'tok-123')).rejects.toMatchObject({ motivo: 'indisponivel' });
  });

  test('401 e 403 viram motivo semPermissao', async () => {
    responder({ status: 401 });
    await expect(fetchChannelQrImage('c1', 'tok-123')).rejects.toMatchObject({ motivo: 'semPermissao' });
    responder({ status: 403 });
    await expect(fetchChannelQrImage('c1', 'tok-123')).rejects.toMatchObject({ motivo: 'semPermissao' });
  });

  test('falha de rede vira motivo erro', async () => {
    global.fetch.mockRejectedValue(new TypeError('failed to fetch'));

    await expect(fetchChannelQrImage('c1', 'tok-123')).rejects.toMatchObject({ motivo: 'erro' });
  });

  // O que chega da rede so vira `src` de imagem depois de provar que e mesmo
  // um data:image/. Nao basta ser string.
  test('recusa image que nao e um data URI de imagem', async () => {
    for (const valor of ['javascript:alert(1)', 'http://exemplo/x.png', 'data:text/html;base64,AAAA', '', 42, undefined]) {
      responder({ corpo: { image: valor } });
      await expect(fetchChannelQrImage('c1', 'tok-123')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
    }
  });

  test('resposta que nao e JSON falha visivel, sem quebrar a tela', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });

    await expect(fetchChannelQrImage('c1', 'tok-123')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
  });
});
