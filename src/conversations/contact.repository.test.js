const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { createCity } = require('../cities/city.repository');
const { createConversation } = require('./conversation.repository');
const {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  claimContactAvatarRefresh,
  findContactById,
  findContactByPhoneNumber,
  updateContact,
  listContactsMissingAvatarForBaileysBackfill,
  setContactSgpLink,
  setContactCityIfEmpty,
  setContactLocalityIfEmpty,
  findContactsWithOwnHistoryByPhoneNumbers,
  renameGhostContactToWaId,
} = require('./contact.repository');
const { createMessage } = require('./message.repository');

describe('contact repository', () => {
  beforeEach(async () => {
    // `channels` entra na limpeza porque os testes de backfill criam canais com
    // telefone fixo, e CASCADE a partir de contacts NAO alcanca channels: o
    // arquivo passava na primeira execucao e falhava na segunda, por telefone
    // duplicado de uma rodada anterior. O banco de teste sobrevive entre rodadas.
    await getPool().query('TRUNCATE channels, contacts, cities CASCADE');
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

  describe('claimContactAvatarRefresh', () => {
    const ONE_HOUR = 60 * 60 * 1000;

    test('claims a contact that was never checked and returns its current avatar path', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
      await setContactAvatarPath(contact.id, 'old.jpg');
      const claimed = await claimContactAvatarRefresh(contact.id, ONE_HOUR);
      expect(claimed).not.toBeNull();
      expect(claimed.id).toBe(contact.id);
      expect(claimed.avatarPath).toBe('old.jpg');
      const found = await findContactById(contact.id);
      expect(found.avatarCheckedAt).not.toBeNull();
    });

    test('refuses a second claim inside the interval', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
      expect(await claimContactAvatarRefresh(contact.id, ONE_HOUR)).not.toBeNull();
      expect(await claimContactAvatarRefresh(contact.id, ONE_HOUR)).toBeNull();
    });

    test('claims again once the last check is older than the interval', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
      await getPool().query("UPDATE contacts SET avatar_checked_at = NOW() - INTERVAL '2 hours' WHERE id = $1", [contact.id]);
      expect(await claimContactAvatarRefresh(contact.id, ONE_HOUR)).not.toBeNull();
    });

    test('a zero interval always claims (forced refresh)', async () => {
      const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
      expect(await claimContactAvatarRefresh(contact.id, ONE_HOUR)).not.toBeNull();
      expect(await claimContactAvatarRefresh(contact.id, 0)).not.toBeNull();
    });

    test('returns null for an unknown contact', async () => {
      expect(await claimContactAvatarRefresh('00000000-0000-0000-0000-000000000000', 0)).toBeNull();
    });
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

  // ADR-011: campo nao enviado permanece inalterado. Antes, a chave ausente
  // virava null no caminho todo e o UPDATE apagava o valor.
  test('updateContact preserva o que nao foi enviado', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await updateContact(contact.id, { displayName: 'Maria', cityId: city.id, internalNote: 'Nota que precisa sobreviver' });

    const soONome = await updateContact(contact.id, { displayName: 'Maria Editada' });

    expect(soONome.displayName).toBe('Maria Editada');
    expect(soONome.cityId).toBe(city.id);
    expect(soONome.internalNote).toBe('Nota que precisa sobreviver');

    const soACidade = await updateContact(contact.id, { cityId: null });
    expect(soACidade.cityId).toBeNull();
    expect(soACidade.displayName).toBe('Maria Editada');
    expect(soACidade.internalNote).toBe('Nota que precisa sobreviver');

    const soANota = await updateContact(contact.id, { internalNote: 'Nota nova' });
    expect(soANota.internalNote).toBe('Nota nova');
    expect(soANota.displayName).toBe('Maria Editada');
  });

  test('updateContact sem campo nenhum nao altera nada', async () => {
    const city = await createCity({ name: 'Bahia' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    const antes = await updateContact(contact.id, { displayName: 'Maria', cityId: city.id, internalNote: 'Nota' });

    const depois = await updateContact(contact.id, {});

    expect(depois).toEqual(antes);
  });

  test('updateContact nunca toca nos campos do SGP', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await setContactSgpLink(contact.id, { sgpClientId: '4321', sgpContractId: '9876', sgpDocument: '12345678900', sgpFirstName: 'Maria' });

    const updated = await updateContact(contact.id, { displayName: 'Outro nome', cityId: null, internalNote: null });

    expect(updated.sgpDocument).toBe('12345678900');
    expect(Number(updated.sgpClientId)).toBe(4321);
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

  test('setContactCityIfEmpty preenche a cidade quando o contato ainda não tem', async () => {
    const city = await createCity({ name: 'Cândido Mendes' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');

    const updated = await setContactCityIfEmpty(contact.id, city.id);

    expect(updated.cityId).toBe(city.id);
    expect((await findContactById(contact.id)).cityId).toBe(city.id);
  });

  test('setContactCityIfEmpty NÃO sobrescreve a cidade que o atendente já escolheu', async () => {
    const escolhida = await createCity({ name: 'Godofredo Viana' });
    const outra = await createCity({ name: 'Cândido Mendes' });
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    await updateContact(contact.id, { displayName: 'Maria', cityId: escolhida.id });

    const updated = await setContactCityIfEmpty(contact.id, outra.id);

    expect(updated).toBeNull();
    expect((await findContactById(contact.id)).cityId).toBe(escolhida.id);
  });

  test('setContactCityIfEmpty devolve null quando o contato não existe', async () => {
    const city = await createCity({ name: 'Cândido Mendes' });
    expect(await setContactCityIfEmpty('00000000-0000-0000-0000-000000000000', city.id)).toBeNull();
  });

  test('a freshly created contact has no internal note', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(contact.internalNote).toBeNull();
  });

  test('setContactSgpLink stores the SGP client link on the contact', async () => {
    const contact = await findOrCreateContactByPhoneNumber('5598911112222', 'Fulano');
    const updated = await setContactSgpLink(contact.id, {
      sgpClientId: 16957, sgpContractId: 17402, sgpDocument: '52998224725',
    });
    expect(updated.sgpClientId).toBe(16957);
    expect(updated.sgpContractId).toBe(17402);
    expect(updated.sgpDocument).toBe('52998224725');

    const reread = await findContactById(contact.id);
    expect(reread.sgpContractId).toBe(17402);
  });

  test('setContactSgpLink can switch the chosen contract without losing the client', async () => {
    const contact = await findOrCreateContactByPhoneNumber('5598933334444', null);
    await setContactSgpLink(contact.id, { sgpClientId: 16957, sgpContractId: 17402, sgpDocument: '52998224725' });
    const updated = await setContactSgpLink(contact.id, { sgpClientId: 16957, sgpContractId: 18511, sgpDocument: '52998224725' });
    expect(updated.sgpClientId).toBe(16957);
    expect(updated.sgpContractId).toBe(18511);
  });

  test('setContactSgpLink guarda o primeiro nome do cliente no contato', async () => {
    const contact = await findOrCreateContactByPhoneNumber('5598955556666', null);

    const updated = await setContactSgpLink(contact.id, {
      sgpClientId: 16957, sgpContractId: 17402, sgpDocument: '52998224725', sgpFirstName: 'João',
    });

    expect(updated.sgpFirstName).toBe('João');
    const reread = await findContactById(contact.id);
    expect(reread.sgpFirstName).toBe('João');
  });

  test('setContactSgpLink sem sgpFirstName (undefined) mantém o nome já gravado', async () => {
    const contact = await findOrCreateContactByPhoneNumber('5598966667777', null);
    await setContactSgpLink(contact.id, { sgpClientId: 16957, sgpContractId: 17402, sgpDocument: '52998224725', sgpFirstName: 'João' });

    const updated = await setContactSgpLink(contact.id, { sgpClientId: 16957, sgpContractId: 18511, sgpDocument: '52998224725' });

    expect(updated.sgpFirstName).toBe('João');
  });

  test('setContactSgpLink com sgpFirstName null apaga o nome (esquecer_identificacao)', async () => {
    const contact = await findOrCreateContactByPhoneNumber('5598977778888', null);
    await setContactSgpLink(contact.id, { sgpClientId: 16957, sgpContractId: 17402, sgpDocument: '52998224725', sgpFirstName: 'João' });

    const updated = await setContactSgpLink(contact.id, {
      sgpClientId: null, sgpContractId: null, sgpDocument: null, sgpFirstName: null,
    });

    expect(updated.sgpFirstName).toBeNull();
    expect(updated.sgpDocument).toBeNull();
  });

  test('contato novo nasce sem primeiro nome do SGP', async () => {
    const contact = await findOrCreateContactByPhoneNumber('5598988889999', null);
    expect(contact.sgpFirstName).toBeNull();
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

describe('contato com localidade', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels, contacts, cities CASCADE');
  });

  async function municipioComPovoado() {
    const m = await getPool().query("INSERT INTO cities (name, kind) VALUES ('Municipio', 'city') RETURNING id");
    const p = await getPool().query(
      "INSERT INTO cities (name, kind, parent_id) VALUES ('Povoado', 'locality', $1) RETURNING id",
      [m.rows[0].id]
    );
    return { municipioId: m.rows[0].id, povoadoId: p.rows[0].id };
  }

  test('todas as leituras devolvem localityId', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000031', 'Ana');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    expect((await findContactById(contato.id)).localityId).toBe(povoadoId);
    expect((await findContactByPhoneNumber('+5511900000031')).localityId).toBe(povoadoId);
    expect((await findOrCreateContactByPhoneNumber('+5511900000031', 'Ana')).localityId).toBe(povoadoId);
  });

  test('contato novo nasce sem localidade', async () => {
    const contato = await findOrCreateContactByPhoneNumber('+5511900000039', 'Novo');

    expect(contato.localityId).toBeNull();
  });

  test('patch sem localityId nao apaga a localidade', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000032', 'Bia');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    const atualizado = await updateContact(contato.id, { displayName: 'Beatriz' });

    expect(atualizado.localityId).toBe(povoadoId);
    expect(atualizado.cityId).toBe(municipioId);
  });

  test('localityId null apaga de proposito, preservando o municipio', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000033', 'Cid');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    const atualizado = await updateContact(contato.id, { localityId: null });

    expect(atualizado.localityId).toBeNull();
    expect(atualizado.cityId).toBe(municipioId);
  });

  test('setContactLocalityIfEmpty nao sobrescreve escolha existente', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const outro = await getPool().query(
      "INSERT INTO cities (name, kind, parent_id) VALUES ('Outro povoado', 'locality', $1) RETURNING id",
      [municipioId]
    );
    const contato = await findOrCreateContactByPhoneNumber('+5511900000034', 'Dora');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    expect(await setContactLocalityIfEmpty(contato.id, outro.rows[0].id)).toBeNull();
    expect((await findContactById(contato.id)).localityId).toBe(povoadoId);
  });

  test('setContactLocalityIfEmpty grava quando esta vazio', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000035', 'Edu');
    await updateContact(contato.id, { cityId: municipioId });

    const atualizado = await setContactLocalityIfEmpty(contato.id, povoadoId);

    expect(atualizado.localityId).toBe(povoadoId);
    expect((await findContactById(contato.id)).localityId).toBe(povoadoId);
  });

  test('setContactSgpLink preserva a localidade', async () => {
    const { municipioId, povoadoId } = await municipioComPovoado();
    const contato = await findOrCreateContactByPhoneNumber('+5511900000036', 'Fabi');
    await updateContact(contato.id, { cityId: municipioId, localityId: povoadoId });

    const atualizado = await setContactSgpLink(contato.id, {
      sgpClientId: 1, sgpContractId: 2, sgpDocument: '000', sgpFirstName: 'Fabi',
    });

    expect(atualizado.localityId).toBe(povoadoId);
  });
});

// Fase 1A (25/09/2026): disparo da Meta e resposta do mesmo celular caíam em dois
// contatos por causa do nono dígito. "Histórico próprio" é a definição aprovada pelo
// proprietário: entrada real, vínculo com o SGP, nota interna, ou conversa que não seja
// só disparo silencioso. Contato que só tem conversa silent de disparo é fantasma.
describe('Fase 1A — contato do disparo e nono dígito', () => {
  let canal;
  let seq = 0;

  beforeEach(async () => {
    await getPool().query('TRUNCATE channels, contacts, cities CASCADE');
    seq += 1;
    canal = await createChannel({ type: 'meta_cloud', name: `Meta ${seq}`, phoneNumber: `+55119988${String(seq).padStart(5, '0')}`, config: {} });
  });

  afterAll(async () => {
    await closePool();
  });

  async function disparo(contatoId, conversa) {
    const conv = conversa || await createConversation(contatoId, canal.id, null, 'silent');
    const msg = await createMessage({ conversationId: conv.id, direction: 'outbound', content: null, status: 'sent', messageType: 'text' });
    return { conv, msg };
  }

  async function entrada(conversaId) {
    return createMessage({ conversationId: conversaId, direction: 'inbound', content: 'oi', status: 'received', messageType: 'text' });
  }

  describe('findContactsWithOwnHistoryByPhoneNumbers', () => {
    test('nenhuma forma cadastrada devolve lista vazia', async () => {
      expect(await findContactsWithOwnHistoryByPhoneNumbers(['5598985120338', '559885120338'])).toEqual([]);
    });

    test('contato fantasma (só conversa silent com disparo) NÃO tem histórico próprio', async () => {
      const fantasma = await findOrCreateContactByPhoneNumber('5598985120338', null);
      await disparo(fantasma.id);
      const [r] = await findContactsWithOwnHistoryByPhoneNumbers(['5598985120338']);
      expect(r.contact.id).toBe(fantasma.id);
      expect(r.contact.phoneNumber).toBe('5598985120338');
      expect(r.temHistoricoProprio).toBe(false);
    });

    test('mensagem de entrada é histórico próprio', async () => {
      const c = await findOrCreateContactByPhoneNumber('559885120338', null);
      const conv = await createConversation(c.id, canal.id);
      await entrada(conv.id);
      const [r] = await findContactsWithOwnHistoryByPhoneNumbers(['559885120338']);
      expect(r.temHistoricoProprio).toBe(true);
    });

    test('vínculo com o SGP é histórico próprio', async () => {
      const c = await findOrCreateContactByPhoneNumber('559885120338', null);
      await setContactSgpLink(c.id, { sgpClientId: 1, sgpContractId: null, sgpDocument: '52998224725', sgpFirstName: 'Ana' });
      const [r] = await findContactsWithOwnHistoryByPhoneNumbers(['559885120338']);
      expect(r.temHistoricoProprio).toBe(true);
    });

    test('nota interna é histórico próprio', async () => {
      const c = await findOrCreateContactByPhoneNumber('559885120338', null);
      await updateContact(c.id, { internalNote: 'cliente antigo' });
      const [r] = await findContactsWithOwnHistoryByPhoneNumbers(['559885120338']);
      expect(r.temHistoricoProprio).toBe(true);
    });

    test('conversa que não é disparo silencioso é histórico próprio, mesmo sem mensagem de entrada', async () => {
      const c = await findOrCreateContactByPhoneNumber('559885120338', null);
      await createConversation(c.id, canal.id, null, 'closed');
      const [r] = await findContactsWithOwnHistoryByPhoneNumbers(['559885120338']);
      expect(r.temHistoricoProprio).toBe(true);
    });

    test('devolve só as formas pedidas, cada uma com a sua marcação', async () => {
      const fantasma = await findOrCreateContactByPhoneNumber('5598985120338', null);
      await disparo(fantasma.id);
      const real = await findOrCreateContactByPhoneNumber('559885120338', null);
      await entrada((await createConversation(real.id, canal.id)).id);
      await findOrCreateContactByPhoneNumber('5511912345678', null);
      const r = await findContactsWithOwnHistoryByPhoneNumbers(['5598985120338', '559885120338']);
      const porNumero = Object.fromEntries(r.map((x) => [x.contact.phoneNumber, x.temHistoricoProprio]));
      expect(porNumero).toEqual({ '5598985120338': false, '559885120338': true });
    });
  });

  // Regra revista pelo proprietário (25/09/2026, antes do merge da Fase 1A): o contato passa ao
  // wa_id quando NÃO tem histórico próprio, ninguém mais tem o wa_id, e os dois números são as
  // formas com e sem o nono dígito do mesmo celular (fixo nunca). Vários disparos antigos em
  // conversa silent não impedem mais. Não é união de contatos: conversas e mensagens ficam no
  // mesmo contact_id, só o phone_number muda.
  describe('renameGhostContactToWaId', () => {
    test('contato recém-criado pelo disparo passa a usar o wa_id', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const { msg } = await disparo(c.id);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885120338', msg.id)).toBe(true);
      expect((await findContactById(c.id)).phoneNumber).toBe('559885120338');
    });

    // Reescrito: pela regra anterior este caso NÃO renomeava ("só o criado agora").
    test('fantasma ANTIGO com vários disparos em conversa silent também passa ao wa_id (regra revista)', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const { conv } = await disparo(c.id);
      await disparo(c.id, conv);
      const { msg: novo } = await disparo(c.id, conv);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885120338', novo.id)).toBe(true);
      expect((await findContactById(c.id)).phoneNumber).toBe('559885120338');
    });

    test('com mensagem de entrada não renomeia', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const { conv, msg } = await disparo(c.id);
      await entrada(conv.id);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885120338', msg.id)).toBe(false);
      expect((await findContactById(c.id)).phoneNumber).toBe('5598985120338');
    });

    test('outro contato já com o wa_id: não renomeia e não lança', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const { msg } = await disparo(c.id);
      await findOrCreateContactByPhoneNumber('559885120338', null);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885120338', msg.id)).toBe(false);
      expect((await findContactById(c.id)).phoneNumber).toBe('5598985120338');
    });

    test('conversa que não é silent (ex.: Iniciar conversa) é histórico próprio: não renomeia', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const conv = await createConversation(c.id, canal.id);
      const { msg } = await disparo(c.id, conv);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885120338', msg.id)).toBe(false);
    });

    test('vínculo com o SGP ou nota interna não renomeiam', async () => {
      const a = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const { msg: ma } = await disparo(a.id);
      await setContactSgpLink(a.id, { sgpClientId: 1, sgpContractId: null, sgpDocument: '52998224725', sgpFirstName: 'Ana' });
      expect(await renameGhostContactToWaId(a.id, '5598985120338', '559885120338', ma.id)).toBe(false);

      const b = await findOrCreateContactByPhoneNumber('5598985120339', null);
      const { msg: mb } = await disparo(b.id);
      await updateContact(b.id, { internalNote: 'nota' });
      expect(await renameGhostContactToWaId(b.id, '5598985120339', '559885120339', mb.id)).toBe(false);
    });

    test('wa_id que não é a variante do nono dígito do número atual não renomeia', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const { msg } = await disparo(c.id);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885129999', msg.id)).toBe(false);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '5598985120338', msg.id)).toBe(false);
      expect((await findContactById(c.id)).phoneNumber).toBe('5598985120338');
    });

    test('fixo nunca é renomeado para uma forma de celular', async () => {
      const c = await findOrCreateContactByPhoneNumber('559832345678', null);
      const { msg } = await disparo(c.id);
      expect(await renameGhostContactToWaId(c.id, '559832345678', '5598932345678', msg.id)).toBe(false);
      expect((await findContactById(c.id)).phoneNumber).toBe('559832345678');
    });

    test('número atual no banco diferente do que foi validado: não renomeia', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      const { msg } = await disparo(c.id);
      await getPool().query('UPDATE contacts SET phone_number = $2 WHERE id = $1', [c.id, '5598985120000']);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885120338', msg.id)).toBe(false);
      expect((await findContactById(c.id)).phoneNumber).toBe('5598985120000');
    });

    test('mensagem que não é deste contato não autoriza renomear', async () => {
      const c = await findOrCreateContactByPhoneNumber('5598985120338', null);
      await disparo(c.id);
      const outro = await findOrCreateContactByPhoneNumber('5598985129999', null);
      const { msg: alheia } = await disparo(outro.id);
      expect(await renameGhostContactToWaId(c.id, '5598985120338', '559885120338', alheia.id)).toBe(false);
    });
  });
});
