const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { createCity } = require('../cities/city.repository');
const { createConversation } = require('./conversation.repository');
const {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  findContactById,
  findContactByPhoneNumber,
  updateContact,
  listContactsMissingAvatarForBaileysBackfill,
} = require('./contact.repository');

describe('contact repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE contacts, cities CASCADE');
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

  test('findContactByPhoneNumber finds an existing contact without creating a new one', async () => {
    const created = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');

    const found = await findContactByPhoneNumber('+5511988887777');

    expect(found.id).toBe(created.id);
    const all = await getPool().query('SELECT count(*) FROM contacts');
    expect(Number(all.rows[0].count)).toBe(1);
  });

  test('findContactByPhoneNumber returns null for an unknown phone number, without creating a contact', async () => {
    const found = await findContactByPhoneNumber('+5511900000000');

    expect(found).toBeNull();
    const all = await getPool().query('SELECT count(*) FROM contacts');
    expect(Number(all.rows[0].count)).toBe(0);
  });

  test('updateContact updates the display name and city', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');

    const updated = await updateContact(contact.id, { displayName: 'Maria Editada', cityId: city.id });

    expect(updated.displayName).toBe('Maria Editada');
    expect(updated.cityId).toBe(city.id);
  });

  test('updateContact with cityId null removes the city', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await updateContact(contact.id, { displayName: 'Maria', cityId: city.id });

    const updated = await updateContact(contact.id, { displayName: 'Maria', cityId: null });

    expect(updated.cityId).toBeNull();
  });

  test('updateContact returns null when the id does not exist', async () => {
    const updated = await updateContact('00000000-0000-0000-0000-000000000000', { displayName: 'X', cityId: null });
    expect(updated).toBeNull();
  });

  test('updateContact stores an internal note', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');

    const updated = await updateContact(contact.id, { displayName: 'Maria', cityId: null, internalNote: 'Já reclamou 3x do mesmo problema' });

    expect(updated.internalNote).toBe('Já reclamou 3x do mesmo problema');
  });

  test('updateContact with internalNote null clears an existing note', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await updateContact(contact.id, { displayName: 'Maria', cityId: null, internalNote: 'Nota antiga' });

    const updated = await updateContact(contact.id, { displayName: 'Maria', cityId: null, internalNote: null });

    expect(updated.internalNote).toBeNull();
  });

  test('a freshly created contact has no internal note', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(contact.internalNote).toBeNull();
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
