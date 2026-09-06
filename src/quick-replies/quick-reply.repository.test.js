const { getPool, closePool } = require('../db/pool');
const { listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply } = require('./quick-reply.repository');

describe('quick-reply repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE quick_replies CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createQuickReply stores and returns a quick reply', async () => {
    const quickReply = await createQuickReply({ title: 'Boas-vindas', content: 'Olá! Como posso ajudar?' });
    expect(quickReply.id).toBeDefined();
    expect(quickReply.title).toBe('Boas-vindas');
    expect(quickReply.content).toBe('Olá! Como posso ajudar?');
    expect(quickReply.createdAt).toBeDefined();
  });

  test('listQuickReplies returns an empty array when there are none', async () => {
    const quickReplies = await listQuickReplies();
    expect(quickReplies).toEqual([]);
  });

  test('listQuickReplies returns all quick replies ordered by title', async () => {
    await createQuickReply({ title: 'Zebra', content: 'Conteúdo Z' });
    await createQuickReply({ title: 'Abelha', content: 'Conteúdo A' });

    const quickReplies = await listQuickReplies();

    expect(quickReplies.map((q) => q.title)).toEqual(['Abelha', 'Zebra']);
  });

  test('updateQuickReply updates and returns the quick reply with new values', async () => {
    const quickReply = await createQuickReply({ title: 'Original', content: 'Texto original' });

    const updated = await updateQuickReply(quickReply.id, { title: 'Editado', content: 'Texto editado' });

    expect(updated.id).toBe(quickReply.id);
    expect(updated.title).toBe('Editado');
    expect(updated.content).toBe('Texto editado');
  });

  test('updateQuickReply returns null when the id does not exist', async () => {
    const updated = await updateQuickReply('00000000-0000-0000-0000-000000000000', { title: 'X', content: 'Y' });
    expect(updated).toBeNull();
  });

  test('deleteQuickReply removes the row and returns true', async () => {
    const quickReply = await createQuickReply({ title: 'Para excluir', content: 'Texto' });

    const deleted = await deleteQuickReply(quickReply.id);

    expect(deleted).toBe(true);
    expect(await listQuickReplies()).toEqual([]);
  });

  test('deleteQuickReply returns false when the id does not exist', async () => {
    const deleted = await deleteQuickReply('00000000-0000-0000-0000-000000000000');
    expect(deleted).toBe(false);
  });
});
