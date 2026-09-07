const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { createConversation } = require('./conversation.repository');
const {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  findContactById,
  listContactsMissingAvatarForBaileysBackfill,
} = require('./contact.repository');

describe('contact repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('creates a new contact when phone number is not known', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(contact.id).toBeDefined();
    expect(contact.phoneNumber).toBe('+5511988887777');
    expect(contact.displayName).toBe('Maria');
    expect(contact.avatarPath).toBeNull();
  });

  test('returns the existing contact on a second call with the same phone number', async () => {
    const first = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    const second = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(second.id).toBe(first.id);
  });

  test('resolves to the same contact when called concurrently for a new phone number', async () => {
    const [first, second] = await Promise.all([
      findOrCreateContactByPhoneNumber('+5511955554444', 'Concurrent Contact'),
      findOrCreateContactByPhoneNumber('+5511955554444', 'Concurrent Contact'),
    ]);
    expect(first.id).toBe(second.id);

    const result = await getPool().query('SELECT count(*) FROM contacts WHERE phone_number = $1', ['+5511955554444']);
    expect(Number(result.rows[0].count)).toBe(1);
  });

  test('marks wasCreated true when a brand-new contact is inserted', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(contact.wasCreated).toBe(true);
  });

  test('marks wasCreated false when reusing an existing contact', async () => {
    await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    const second = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(second.wasCreated).toBe(false);
  });

  test('setContactAvatarPath stores the path, reflected by a later findContactById', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await setContactAvatarPath(contact.id, 'abc123.jpg');
    const found = await findContactById(contact.id);
    expect(found.avatarPath).toBe('abc123.jpg');
  });

  test('findContactById returns null for an unknown id', async () => {
    const found = await findContactById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });

  describe('listContactsMissingAvatarForBaileysBackfill', () => {
    test('returns a contact with no avatar that has a Baileys conversation', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
      const channel = await createChannel({ type: 'baileys', name: 'Baileys Teste', phoneNumber: '+5511999990000', config: {} });
      await createConversation(contact.id, channel.id);

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([{ contactId: contact.id, phoneNumber: '+5511977776666', channelId: channel.id }]);
    });

    test('excludes a contact that already has an avatar', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776667', 'Joao Dois');
      const channel = await createChannel({ type: 'baileys', name: 'Baileys Teste 2', phoneNumber: '+5511999990001', config: {} });
      await createConversation(contact.id, channel.id);
      await setContactAvatarPath(contact.id, 'existing.jpg');

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([]);
    });

    test('excludes a contact whose only conversation is on a Meta Cloud channel', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776668', 'Joao Tres');
      const channel = await createChannel({
        type: 'meta_cloud',
        name: 'Meta Teste',
        phoneNumber: '+5511999990002',
        config: { phoneNumberId: '1', accessToken: 'x' },
      });
      await createConversation(contact.id, channel.id);

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([]);
    });

    test('picks the most recently updated Baileys channel when a contact has conversations on more than one', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511977776669', 'Joao Quatro');
      const olderChannel = await createChannel({ type: 'baileys', name: 'Canal Antigo', phoneNumber: '+5511999990003', config: {} });
      const newerChannel = await createChannel({ type: 'baileys', name: 'Canal Novo', phoneNumber: '+5511999990004', config: {} });
      await createConversation(contact.id, olderChannel.id);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createConversation(contact.id, newerChannel.id);

      const results = await listContactsMissingAvatarForBaileysBackfill();

      expect(results).toEqual([{ contactId: contact.id, phoneNumber: '+5511977776669', channelId: newerChannel.id }]);
    });
  });
});
