import { describe, test, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiError, login, getQueue, setUnauthorizedHandler } from './api';

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
});

describe('ApiError', () => {
  test('carries status and body', () => {
    const err = new ApiError(404, { error: 'Not found' });
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: 'Not found' });
    expect(err.message).toBe('Not found');
  });
});
