jest.mock('axios');
const axios = require('axios');
const FormData = require('form-data');
const { createChatCompletion, listModels, transcribeAudio, analyzeImage, OpenAiRequestError, OpenAiAuthError } = require('./openai-client');

describe('openai-client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends the key in the Authorization header and never in the body', async () => {
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { role: 'assistant', content: 'oi' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } },
    });

    await createChatCompletion({ apiKey: 'sk-secreta', model: 'gpt-x', messages: [{ role: 'user', content: 'oi' }], tools: [] });

    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer sk-secreta');
    expect(JSON.stringify(body)).not.toContain('sk-secreta');
  });

  test('returns the assistant message and the usage', async () => {
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { role: 'assistant', content: 'Seu plano é 600MB.' } }], usage: { prompt_tokens: 120, completion_tokens: 35 } },
    });

    const result = await createChatCompletion({ apiKey: 'sk', model: 'gpt-x', messages: [], tools: [] });

    expect(result.message.content).toBe('Seu plano é 600MB.');
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 35 });
  });

  test('omits the tools field entirely when there are no enabled tools', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: {} }], usage: {} } });
    await createChatCompletion({ apiKey: 'sk', model: 'gpt-x', messages: [], tools: [] });
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty('tools');
  });

  test('toolChoice vira tool_choice de função no corpo; ausente, nada é enviado', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }], usage: {} } });
    await createChatCompletion({ apiKey: 'sk', model: 'm', messages: [], tools: [{ type: 'function', function: { name: 'concluir_triagem' } }], toolChoice: 'concluir_triagem' });
    expect(axios.post.mock.calls[0][1].tool_choice).toEqual({ type: 'function', function: { name: 'concluir_triagem' } });
    await createChatCompletion({ apiKey: 'sk', model: 'm', messages: [], tools: [] });
    expect(axios.post.mock.calls[1][1]).not.toHaveProperty('tool_choice');
    await createChatCompletion({ apiKey: 'sk', model: 'm', messages: [], tools: [{ type: 'function', function: { name: 'gerar_pix' } }], toolChoice: 'required' });
    expect(axios.post.mock.calls[2][1].tool_choice).toBe('required');
  });

  test('throws OpenAiAuthError on 401', async () => {
    axios.post.mockRejectedValue({ response: { status: 401, data: { error: { message: 'bad key' } } } });
    await expect(createChatCompletion({ apiKey: 'sk', model: 'g', messages: [], tools: [] }))
      .rejects.toBeInstanceOf(OpenAiAuthError);
  });

  test('throws OpenAiRequestError on any other failure', async () => {
    axios.post.mockRejectedValue(new Error('timeout'));
    await expect(createChatCompletion({ apiKey: 'sk', model: 'g', messages: [], tools: [] }))
      .rejects.toBeInstanceOf(OpenAiRequestError);
  });

  test('listModels returns the sorted model ids', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] } });
    expect(await listModels('sk')).toEqual(['gpt-a', 'gpt-b']);
  });

  test('does not leak the API key in the error cause on non-401 failures', async () => {
    const axiosError = {
      response: { status: 500, data: { error: { message: 'server error' } } },
      config: {
        headers: { Authorization: 'Bearer sk-secreta' },
        data: '{"model":"gpt-x"}',
      },
      message: 'Request failed with status code 500',
    };
    axios.post.mockRejectedValue(axiosError);

    try {
      await createChatCompletion({ apiKey: 'sk-secreta', model: 'gpt-x', messages: [], tools: [] });
      fail('should have thrown');
    } catch (err) {
      const serialized = JSON.stringify(err) + JSON.stringify(err.cause);
      expect(serialized).not.toContain('sk-secreta');
      expect(serialized).not.toContain('Bearer');
    }
  });

  test('does not leak the API key in the error cause on 401 failures', async () => {
    const axiosError = {
      response: { status: 401, data: { error: { message: 'bad key' } } },
      config: {
        headers: { Authorization: 'Bearer sk-secreta' },
        data: '{"model":"gpt-x"}',
      },
      message: 'Request failed with status code 401',
    };
    axios.post.mockRejectedValue(axiosError);

    try {
      await createChatCompletion({ apiKey: 'sk-secreta', model: 'gpt-x', messages: [], tools: [] });
      fail('should have thrown');
    } catch (err) {
      const serialized = JSON.stringify(err) + JSON.stringify(err.cause);
      expect(serialized).not.toContain('sk-secreta');
      expect(serialized).not.toContain('Bearer');
    }
  });

  describe('transcribeAudio', () => {
    const fs = require('fs');

    test('manda a chave só no cabeçalho e o modelo no formulário', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockResolvedValue({ data: { text: 'minha internet caiu' } });
      // Spy no append em vez de espiar o interno `_streams` do form-data: se a
      // chave algum dia for anexada ao corpo, ESTA asserção falha. Uma checagem
      // sobre `_streams` passaria a vazio caso a propriedade não exista.
      const appendSpy = jest.spyOn(FormData.prototype, 'append');

      const result = await transcribeAudio({
        apiKey: 'sk-secreta', model: 'modelo-x', filePath: '/tmp/a.ogg',
        mimeType: 'audio/ogg', prompt: 'PPPoE, ONU',
      });

      const [url, , options] = axios.post.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect(options.headers.Authorization).toBe('Bearer sk-secreta');
      const contentType = options.headers['content-type'] || options.headers['Content-Type'];
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
      // axios's AxiosHeaders merges header names case-insensitively, so a
      // capitalized 'Content-Type' surviving alongside the lowercase one from
      // form-data collides in the real request and overwrites the boundary
      // (see Finding 1). Since axios is mocked here, the case-insensitive
      // collision itself can't be observed on this plain object — but its
      // cause (a stray capitalized key) can: assert it is simply absent.
      expect(options.headers['Content-Type']).toBeUndefined();
      expect(result).toEqual({ texto: 'minha internet caiu' });

      const campos = appendSpy.mock.calls.map((c) => c[0]);
      expect(campos).toContain('model');
      expect(campos).toContain('file');
      expect(campos).toContain('prompt');
      expect(appendSpy.mock.calls.some((c) => String(c[1]).includes('sk-secreta'))).toBe(false);

      appendSpy.mockRestore();
      fs.createReadStream.mockRestore();
    });

    test('Finding 2: usa o filename recebido, para a OpenAI escolher o decodificador certo (ex.: .m4a)', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockResolvedValue({ data: { text: 'ok' } });
      const appendSpy = jest.spyOn(FormData.prototype, 'append');

      await transcribeAudio({
        apiKey: 'sk', model: 'm', filePath: '/tmp/a.m4a', mimeType: 'audio/mp4', filename: 'audio.m4a',
      });

      const fileCall = appendSpy.mock.calls.find((c) => c[0] === 'file');
      expect(fileCall[2]).toEqual(expect.objectContaining({ filename: 'audio.m4a', contentType: 'audio/mp4' }));

      appendSpy.mockRestore();
      fs.createReadStream.mockRestore();
    });

    test('sem filename, cai no fallback antigo por mimeType (compatibilidade)', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockResolvedValue({ data: { text: 'ok' } });
      const appendSpy = jest.spyOn(FormData.prototype, 'append');

      await transcribeAudio({ apiKey: 'sk', model: 'm', filePath: '/tmp/a.ogg', mimeType: 'audio/ogg' });

      const fileCall = appendSpy.mock.calls.find((c) => c[0] === 'file');
      expect(fileCall[2].filename).toBe('audio.ogg');

      appendSpy.mockRestore();
      fs.createReadStream.mockRestore();
    });

    test('devolve apenas o texto, ignorando campos extras da resposta', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockResolvedValue({ data: { text: 'oi', language: 'pt', duration: 3.2, segments: [] } });
      const result = await transcribeAudio({ apiKey: 'sk', model: 'm', filePath: '/tmp/a.ogg', mimeType: 'audio/ogg' });
      expect(result).toEqual({ texto: 'oi' });
      fs.createReadStream.mockRestore();
    });

    test('filePath inválido não escapa do módulo cru: ainda sai como OpenAiRequestError', async () => {
      // Sem mockar fs.createReadStream aqui de propósito: queremos o erro
      // síncrono real que o Node lança para um filePath do tipo errado, para
      // confirmar que ele é capturado e traduzido, não vazado cru.
      await expect(
        transcribeAudio({ apiKey: 'sk', model: 'm', filePath: undefined, mimeType: 'audio/ogg' })
      ).rejects.toBeInstanceOf(OpenAiRequestError);
    });

    test('401 vira OpenAiAuthError', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockRejectedValue({ response: { status: 401 }, message: 'bad key' });
      await expect(
        transcribeAudio({ apiKey: 'sk', model: 'm', filePath: '/tmp/a.ogg', mimeType: 'audio/ogg' })
      ).rejects.toBeInstanceOf(OpenAiAuthError);
      fs.createReadStream.mockRestore();
    });

    test('a chave não vaza pela causa do erro', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      const erroReal = new Error('Request failed with status code 500');
      erroReal.response = { status: 500 };
      erroReal.config = { headers: { Authorization: 'Bearer sk-secreta' }, data: 'binario' };
      axios.post.mockRejectedValue(erroReal);

      let capturado;
      try {
        await transcribeAudio({ apiKey: 'sk-secreta', model: 'm', filePath: '/tmp/a.ogg', mimeType: 'audio/ogg' });
      } catch (err) {
        capturado = err;
      }
      const serializado = JSON.stringify(capturado) + JSON.stringify(capturado.cause);
      expect(serializado).not.toContain('sk-secreta');
      expect(serializado).not.toContain('Bearer');
      fs.createReadStream.mockRestore();
    });
  });

  describe('analyzeImage', () => {
    test('manda a imagem como data URL, pede JSON e devolve o objeto parseado', async () => {
      axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{"ehComprovante":true,"valor":135}' } }], usage: {} } });
      const r = await analyzeImage({ apiKey: 'sk', model: 'gpt-x', imageBuffer: Buffer.from('img'), mimeType: 'image/png', prompt: 'leia' });
      expect(r).toEqual({ ehComprovante: true, valor: 135 });
      const body = axios.post.mock.calls[0][1];
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages[0].content[1].image_url.url).toBe(`data:image/png;base64,${Buffer.from('img').toString('base64')}`);
      expect(body.messages[0].content[0]).toEqual({ type: 'text', text: 'leia' });
    });

    // O turno inteiro tem 120 s (TURNO_MAX_MS). Com 60 s aqui, uma visão lenta
    // mais o desbloqueio (40 s) não deixavam tempo para o modelo escrever o
    // "prontinho": o turno estourava DEPOIS da liberação, com o cliente sem
    // resposta nenhuma. 45 s ainda cobre folgado uma leitura de comprovante.
    test('a leitura de imagem tem orçamento de 45 s, menor que o do turno', async () => {
      axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{"ehComprovante":true}' } }], usage: {} } });
      await analyzeImage({ apiKey: 'sk', model: 'gpt-x', imageBuffer: Buffer.from('img'), mimeType: 'image/png', prompt: 'leia' });
      expect(axios.post.mock.calls[0][2].timeout).toBe(45000);
    });

    test('resposta que não é JSON vira erro OpenAiRequestError, sem vazar o conteúdo', async () => {
      axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'não sei' } }], usage: {} } });
      await expect(analyzeImage({ apiKey: 'sk', model: 'gpt-x', imageBuffer: Buffer.from('x'), mimeType: 'image/png', prompt: 'p' })).rejects.toThrow(/JSON/);
    });
  });
});
