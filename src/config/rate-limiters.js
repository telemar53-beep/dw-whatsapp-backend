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
      console.warn(`Rate limit exceeded (${name}) for ${req.ip} on ${req.originalUrl}`);
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
