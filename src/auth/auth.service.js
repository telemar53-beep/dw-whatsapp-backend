const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { findAgentByEmail } = require('../agents/agent.repository');

const TOKEN_EXPIRY = '12h';

function invalidCredentialsError() {
  const err = new Error('Invalid credentials');
  err.code = 'INVALID_CREDENTIALS';
  return err;
}

async function login({ email, password }) {
  const agent = await findAgentByEmail(email);
  if (!agent) {
    throw invalidCredentialsError();
  }
  const matches = await bcrypt.compare(password, agent.passwordHash);
  if (!matches) {
    throw invalidCredentialsError();
  }
  const token = jwt.sign(
    { agentId: agent.id, role: agent.role },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
  return { token, agent: { id: agent.id, email: agent.email, role: agent.role } };
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { login, verifyToken };
