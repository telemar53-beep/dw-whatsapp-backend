const rateLimit = require('express-rate-limit');

function createRateLimiter({ windowMs, max, name }) {
  if (process.env.NODE_ENV === 'test') {
    return (req, res, next) => next();
  }
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      // Só o caminho, nunca a query. É por ela que passam o JWT de sessão, a
      // chave de API do SGP, o telefone do cliente e até o texto da mensagem —
      // e este console.warn era o único ponto do servidor que imprimia tudo
      // isso em claro. O caminho sozinho basta para saber quem está estourando.
      const caminhoSemQuery = String(req.originalUrl || '').split('?')[0];
      console.warn(`Rate limit exceeded (${name}) for ${req.ip} on ${req.method} ${caminhoSemQuery}`);
      res.status(429).json({ error: 'Too many requests, please try again later' });
    },
  });
}

// SGP itself paces its own dispatches at one every 15s (~4/min); this leaves
// comfortable headroom for real traffic while still capping token-guessing abuse.
const sgpLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, name: 'sgp-webhook' });

// Generous enough for several attendants sharing one office's public IP.
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'login' });
const globalLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 300, name: 'global' });

module.exports = { createRateLimiter, loginLimiter, sgpLimiter, globalLimiter };
