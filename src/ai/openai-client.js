const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

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
    const cause = { status: err.response.status, message: err.response.data?.error?.message || err.message };
    return new OpenAiAuthError('OpenAI rejected the API key', { cause });
  }
  console.error(`OpenAI request failed: ${contexto}`, err.response ? { status: err.response.status } : { message: err.message });
  const cause = { status: err.response && err.response.status, message: err.message };
  return new OpenAiRequestError(`Failed to reach OpenAI at ${contexto}`, { cause });
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

const TRANSCRIPTION_TIMEOUT_MS = 120000;

async function transcribeAudio({ apiKey, model, filePath, mimeType, prompt }) {
  let response;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename: 'audio' + (mimeType === 'audio/mpeg' ? '.mp3' : '.ogg'),
      contentType: mimeType || 'audio/ogg',
    });
    form.append('model', model);
    if (prompt) form.append('prompt', prompt);

    // Só o Authorization é somado aos cabeçalhos do form-data: espalhar o
    // objeto inteiro de `headers(apiKey)` reintroduziria um 'Content-Type'
    // com C maiúsculo, que o AxiosHeaders do axios trata como o mesmo campo
    // (case-insensitive) do 'content-type' minúsculo do form-data e acaba
    // vencendo — apagando o boundary multipart e quebrando toda chamada real.
    response = await axios.post(`${BASE_URL}/audio/transcriptions`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
      timeout: TRANSCRIPTION_TIMEOUT_MS,
      maxBodyLength: Infinity,
    });
  } catch (err) {
    throw traduzErro(err, '/audio/transcriptions');
  }

  // Só o texto é lido: a resposta traz campos diferentes conforme o modelo e o
  // formato pedido, e o módulo não deve quebrar quando o admin trocar de modelo.
  return { texto: (response.data && response.data.text) || '' };
}

module.exports = { createChatCompletion, listModels, transcribeAudio, OpenAiRequestError, OpenAiAuthError };
