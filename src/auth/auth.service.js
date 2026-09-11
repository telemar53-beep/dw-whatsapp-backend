const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { findAgentByEmail, findAgentByIdWithPasswordHash, updateAgentPassword } = require('../agents/agent.repository');

const TOKEN_EXPIRY = '12h';
const SALT_ROUNDS = 10;
// Excludes 0/O and 1/I/l so a generated password can be read aloud or typed
// without ambiguity (the admin often has to relay it to the agent by phone).
const GENERATED_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const GENERATED_PASSWORD_LENGTH = 12;

function invalidCredentialsError() {
  const err = new Error('Invalid credentials');
  err.code = 'INVALID_CREDENTIALS';
  return err;
}

function accountDisabledError() {
  const err = new Error('Account disabled');
  err.code = 'ACCOUNT_DISABLED';
  return err;
}

function invalidCurrentPasswordError() {
  const err = new Error('Current password is incorrect');
  err.code = 'INVALID_CURRENT_PASSWORD';
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
  if (agent.active === false) {
    throw accountDisabledError();
  }
  const token = jwt.sign(
    { agentId: agent.id, role: agent.role },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
  return { token, agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role } };
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

async function changePassword({ agentId, currentPassword, newPassword }) {
  const agent = await findAgentByIdWithPasswordHash(agentId);
  const matches = agent && (await bcrypt.compare(currentPassword, agent.passwordHash));
  if (!matches) {
    throw invalidCurrentPasswordError();
  }
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await updateAgentPassword(agentId, newHash);
}

function generatePassword() {
  const bytes = crypto.randomBytes(GENERATED_PASSWORD_LENGTH);
  let password = '';
  for (let i = 0; i < GENERATED_PASSWORD_LENGTH; i++) {
    password += GENERATED_PASSWORD_CHARSET[bytes[i] % GENERATED_PASSWORD_CHARSET.length];
  }
  return password;
}

async function resetAgentPassword(agentId) {
  const newPassword = generatePassword();
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await updateAgentPassword(agentId, newHash);
  return newPassword;
}

module.exports = { login, verifyToken, changePassword, resetAgentPassword };
