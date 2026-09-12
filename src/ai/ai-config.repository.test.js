const { getPool, closePool } = require('../db/pool');
const {
  getAiConfig, updateAiConfig, listToolPermissions, setToolPermission, isToolEnabled,
} = require('./ai-config.repository');

describe('ai config repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_tool_permissions');
    await getPool().query("UPDATE ai_config SET api_key = NULL, model = '', mode = 'disabled' WHERE id = 1");
  });

  afterAll(async () => { await closePool(); });

  test('getAiConfig returns the seeded singleton row', async () => {
    const config = await getAiConfig();
    expect(config.id).toBe(1);
    expect(config.mode).toBe('disabled');
    expect(config.apiKey).toBeNull();
    expect(config.systemPrompt).toContain('DW Telecom');
    expect(config.maxToolsPerInteraction).toBe(8);
  });

  test('updateAiConfig stores the key and the mode', async () => {
    const updated = await updateAiConfig({ apiKey: 'sk-abc', model: 'gpt-x', mode: 'assistant' });
    expect(updated.apiKey).toBe('sk-abc');
    expect(updated.model).toBe('gpt-x');
    expect(updated.mode).toBe('assistant');
  });

  test('updateAiConfig keeps the stored key when apiKey is omitted', async () => {
    await updateAiConfig({ apiKey: 'sk-original', model: 'gpt-x', mode: 'assistant' });
    const updated = await updateAiConfig({ apiKey: null, model: 'gpt-y', mode: 'automatic' });
    expect(updated.apiKey).toBe('sk-original');
    expect(updated.model).toBe('gpt-y');
  });

  test('setToolPermission inserts then updates the same row', async () => {
    await setToolPermission('buscar_cliente', true);
    await setToolPermission('buscar_cliente', false);
    const all = await listToolPermissions();
    expect(all).toEqual([{ toolName: 'buscar_cliente', enabled: false }]);
  });

  test('isToolEnabled defaults to false for an unknown tool', async () => {
    expect(await isToolEnabled('nunca_cadastrada')).toBe(false);
    await setToolPermission('consultar_plano', true);
    expect(await isToolEnabled('consultar_plano')).toBe(true);
  });
});
