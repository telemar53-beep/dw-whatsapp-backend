const { loadConfig } = require('./env');

function getAllowedOrigins() {
  const origins = ['http://localhost:5173'];
  const { frontendOrigin } = loadConfig();
  if (frontendOrigin) {
    origins.push(frontendOrigin);
  }
  return origins;
}

module.exports = { getAllowedOrigins };
