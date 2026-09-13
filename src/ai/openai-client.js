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

async function createChatCompletion({ apiKey, model, messages, tools, toolChoice }) {
  const body = { model, messages };
  if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
  // 'required' = qualquer ferramenta, mas alguma (usado no limite de perguntas
  // da triagem); qualquer outro valor é o nome de uma função específica.
  if (toolChoice && body.tools) {
    body.tool_choice = toolChoice === 'required' ? 'required' : { type: 'function', function: { name: toolChoice } };
  }

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

// Leitura de imagem (comprovante de pagamento). A imagem viaja como data URL
// em base64 dentro do próprio corpo: nada é hospedado nem exposto por URL
// pública, e o caminho do arquivo em disco nunca sai daqui.
const VISION_TIMEOUT_MS = 60000;

async function analyzeImage({ apiKey, model, imageBuffer, mimeType, prompt }) {
  const body = {
    model,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } },
      ],
    }],
  };
  let response;
  try {
    response = await axios.post(`${BASE_URL}/chat/completions`, body, { headers: headers(apiKey), timeout: VISION_TIMEOUT_MS });
  } catch (err) {
    throw traduzErro(err, '/chat/completions (vision)');
  }
  const content = (((response.data.choices || [])[0] || {}).message || {}).content || '';
  try {
    return JSON.parse(content);
  } catch (err) {
    // O texto bruto não vai para a mensagem de erro: pode conter dados do comprovante.
    throw new OpenAiRequestError('Vision response was not valid JSON');
  }
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

async function transcribeAudio({ apiKey, model, filePath, mimeType, prompt, filename }) {
  let response;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      // A OpenAI escolhe o decodificador pela extensão do nome, não pelo
      // contentType — por isso o chamador manda o filename com a extensão real
      // do arquivo salvo em disco (extensionForMimeType em media-storage.js).
      // O fallback só cobre uma chamada antiga sem esse campo.
      filename: filename || 'audio' + (mimeType === 'audio/mpeg' ? '.mp3' : '.ogg'),
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

module.exports = { createChatCompletion, listModels, transcribeAudio, analyzeImage, OpenAiRequestError, OpenAiAuthError };
