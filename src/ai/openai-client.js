const axios = require('axios');

const BASE_URL = 'https://api.openai.com/v1';
const TIMEOUT_MS = 60000;

class OpenAiRequestError extends Error {}
class OpenAiAuthError extends Error {}

function headers(apiKey) {
  // A chave vive só aqui, no cabeçalho. Nunca no corpo, nunca no contexto do modelo.
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function traduzErro(err, contexto) {
  if (err.response && err.response.status === 401) {
    return new OpenAiAuthError('OpenAI rejected the API key');
  }
  console.error(`OpenAI request failed: ${contexto}`, err.response ? { status: err.response.status } : { message: err.message });
  return new OpenAiRequestError(`Failed to reach OpenAI at ${contexto}`, { cause: err });
}

async function createChatCompletion({ apiKey, model, messages, tools }) {
  const body = { model, messages };
  if (Array.isArray(tools) && tools.length > 0) body.tools = tools;

  let response;
  try {
    response = await axios.post(`${BASE_URL}/chat/completions`, body, {
      headers: headers(apiKey),
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    throw traduzErro(err, '/chat/completions');
  }

  const choice = (response.data.choices || [])[0] || {};
  const usage = response.data.usage || {};
  return {
    message: choice.message || {},
    usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens },
  };
}

async function listModels(apiKey) {
  let response;
  try {
    response = await axios.get(`${BASE_URL}/models`, { headers: headers(apiKey), timeout: 15000 });
  } catch (err) {
    throw traduzErro(err, '/models');
  }
  return (response.data.data || []).map((m) => m.id).sort();
}

module.exports = { createChatCompletion, listModels, OpenAiRequestError, OpenAiAuthError };
