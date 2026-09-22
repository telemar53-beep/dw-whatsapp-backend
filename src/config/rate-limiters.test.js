const express = require('express');
const request = require('supertest');
const { createRateLimiter, loginLimiter, sgpLimiter, globalLimiter } = require('./rate-limiters');

function appWith(middleware) {
  const app = express();
  app.use(middleware);
  app.get('/probe', (req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  test('is a no-op (never 429s) when NODE_ENV is "test"', async () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1, name: 'test-noop' });
    const app = appWith(limiter);

    const first = await request(app).get('/probe');
    const second = await request(app).get('/probe');
    const third = await request(app).get('/probe');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
  });

  test('enforces the configured limit and returns 429 with the standard error body outside test env', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const limiter = createRateLimiter({ windowMs: 60000, max: 2, name: 'test-enforced' });
      const app = appWith(limiter);

      const first = await request(app).get('/probe');
      const second = await request(app).get('/probe');
      const third = await request(app).get('/probe');

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.body).toEqual({ error: 'Too many requests, please try again later' });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // A query string e por onde passam JWT de sessao, a chave de API do SGP, o
  // telefone do cliente e ate o texto da mensagem. O log de limite nao pode
  // carregar nada disso.
  describe('o log de limite nao vaza a query string', () => {
    async function estourarOLimite(caminho) {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const limiter = createRateLimiter({ windowMs: 60000, max: 1, name: 'test-log' });
        const app = appWith(limiter);
        await request(app).get(caminho);
        const estourou = await request(app).get(caminho);
        expect(estourou.status).toBe(429);
        return warn.mock.calls.map((argumentos) => argumentos.join(' ')).join('\n');
      } finally {
        warn.mockRestore();
        process.env.NODE_ENV = originalEnv;
      }
    }

    test('um token na url nao aparece no log', async () => {
      const logado = await estourarOLimite('/probe?token=SEGREDO');

      expect(logado).not.toContain('SEGREDO');
      expect(logado).not.toContain('token=');
      expect(logado).not.toContain('?');
    });

    test('nenhum valor de uma query com varios parametros sensiveis vaza', async () => {
      const logado = await estourarOLimite(
        '/probe?token=JWT_SECRETO&phoneNumber=5511999998888&content=Seu+boleto+vence+amanha&referenceId=REF123'
      );

      for (const valor of ['JWT_SECRETO', '5511999998888', 'boleto', 'REF123', 'phoneNumber', 'content']) {
        expect(logado).not.toContain(valor);
      }
    });

    test('o log continua util: nome do limiter, ip, metodo e caminho', async () => {
      const logado = await estourarOLimite('/probe?token=SEGREDO');

      expect(logado).toContain('test-log');
      expect(logado).toContain('GET');
      expect(logado).toContain('/probe');
      expect(logado).toMatch(/Rate limit exceeded/);
    });
  });

  test('exports pre-configured limiters for login, the SGP webhook, and a global fallback', () => {
    expect(typeof loginLimiter).toBe('function');
    expect(typeof sgpLimiter).toBe('function');
    expect(typeof globalLimiter).toBe('function');
  });
});
