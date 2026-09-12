jest.mock('axios');
const axios = require('axios');
const { createChatCompletion, listModels, OpenAiRequestError, OpenAiAuthError } = require('./openai-client');

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
});
