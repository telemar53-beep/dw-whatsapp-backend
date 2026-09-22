const { getPool, closePool } = require('../db/pool');
const {
  createCampaign,
  findCampaignById,
  listCampaigns,
  countCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
  deleteCampaign,
} = require('./campaign.repository');
const { createAgent } = require('../agents/agent.repository');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');

async function makeAgent() {
  return createAgent({ name: 'Ana', email: `ana-${Date.now()}-${Math.random()}@dw.com`, password: 'secret123', role: 'agent' });
}

async function makeChannel() {
  return createChannel({
    type: 'baileys',
    name: `Canal ${Date.now()}-${Math.random()}`,
    phoneNumber: `+551199990000${Math.floor(Math.random() * 1000)}`,
    config: {},
  });
}

describe('campaign repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE campaign_recipients, campaigns, conversations, contacts, agents, channels CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createCampaign stores and returns a text campaign', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();

    const campaign = await createCampaign({
      name: 'Aviso',
      channelId: channel.id,
      messageType: 'text',
      content: 'Ola clientes',
      createdBy: agent.id,
      totalRecipients: 3,
    });

    expect(campaign.id).toBeDefined();
    expect(campaign.name).toBe('Aviso');
    expect(campaign.messageType).toBe('text');
    expect(campaign.content).toBe('Ola clientes');
    expect(campaign.templateName).toBeNull();
    expect(campaign.totalRecipients).toBe(3);
    expect(campaign.sentCount).toBe(0);
    expect(campaign.failedCount).toBe(0);
    expect(campaign.skippedCount).toBe(0);
  });

  test('createCampaign stores template fields for a template campaign', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();

    const campaign = await createCampaign({
      channelId: channel.id,
      messageType: 'template',
      content: 'Ola Joao, sua fatura vence em 10/09',
      templateName: 'fatura_vencendo',
      templateLanguage: 'pt_BR',
      templateVariables: ['Joao', '10/09'],
      createdBy: agent.id,
      totalRecipients: 1,
    });

    expect(campaign.templateName).toBe('fatura_vencendo');
    expect(campaign.templateLanguage).toBe('pt_BR');
    expect(campaign.templateVariables).toEqual(['Joao', '10/09']);
  });

  test('findCampaignById returns null when not found', async () => {
    const result = await findCampaignById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  test('listCampaigns returns campaigns newest first', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const first = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'b', createdBy: agent.id, totalRecipients: 1 });

    const campaigns = await listCampaigns();

    expect(campaigns[0].id).toBe(second.id);
    expect(campaigns[1].id).toBe(first.id);
  });

  test('listCampaigns traz o nome do canal junto', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1 });

    const [campanha] = await listCampaigns();

    expect(campanha.channelName).toBe(channel.name);
    expect(campanha.channelId).toBe(channel.id);
  });

  test('findCampaignById tambem traz o nome do canal', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const criada = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1 });

    const campanha = await findCampaignById(criada.id);

    expect(campanha.channelName).toBe(channel.name);
  });

  test('o nome do canal nao muda nenhum outro campo da campanha', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const criada = await createCampaign({
      name: 'Aviso',
      channelId: channel.id,
      messageType: 'text',
      content: 'ola',
      createdBy: agent.id,
      totalRecipients: 3,
    });

    const campanha = await findCampaignById(criada.id);

    // O campo novo e espalhado no call site, nunca dentro de toCampaign: o
    // INSERT ... RETURNING de createCampaign nao tem o JOIN e nao pode mudar.
    const { channelName, ...semOCampoNovo } = campanha;
    expect(channelName).toBe(channel.name);
    expect(semOCampoNovo).toEqual(criada);
    expect(criada).not.toHaveProperty('channelName');
  });

  test('listCampaigns ordena por data e desempata por id, de forma deterministica', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    // Mesmo created_at nos tres: sem desempate, a ordem do Postgres e indefinida.
    const criadas = await Promise.all([1, 2, 3].map((n) => createCampaign({
      name: `Campanha ${n}`,
      channelId: channel.id,
      messageType: 'text',
      content: 'a',
      createdBy: agent.id,
      totalRecipients: 1,
    })));
    await getPool().query(`UPDATE campaigns SET created_at = now()`);

    const primeira = (await listCampaigns()).map((c) => c.id);
    const segunda = (await listCampaigns()).map((c) => c.id);

    expect(primeira).toEqual(segunda);
    expect(primeira.sort()).toEqual(criadas.map((c) => c.id).sort());
  });

  describe('paginacao da lista', () => {
    async function tresCampanhas() {
      const agent = await makeAgent();
      const channel = await makeChannel();
      const criadas = [];
      for (const nome of ['primeira', 'segunda', 'terceira']) {
        criadas.push(await createCampaign({
          name: nome, channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1,
        }));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return criadas;
    }

    test('sem opcoes devolve tudo, como antes', async () => {
      const criadas = await tresCampanhas();
      const todas = await listCampaigns();
      expect(todas).toHaveLength(3);
      expect(todas[0].id).toBe(criadas[2].id);
    });

    test('um objeto de opcoes vazio tambem devolve tudo', async () => {
      await tresCampanhas();
      expect(await listCampaigns({})).toHaveLength(3);
    });

    test('pagina sem repetir nem pular campanha', async () => {
      const criadas = await tresCampanhas();
      const maisNovaPrimeiro = [criadas[2].id, criadas[1].id, criadas[0].id];

      const p1 = await listCampaigns({ limit: 2, offset: 0 });
      const p2 = await listCampaigns({ limit: 2, offset: 2 });
      const p3 = await listCampaigns({ limit: 2, offset: 4 });

      expect([...p1, ...p2].map((c) => c.id)).toEqual(maisNovaPrimeiro);
      expect(p3).toEqual([]);
    });

    test('a pagina carrega o nome do canal igual a lista inteira', async () => {
      await tresCampanhas();
      const [daPagina] = await listCampaigns({ limit: 1, offset: 0 });
      const [daListaInteira] = await listCampaigns();
      expect(daPagina).toEqual(daListaInteira);
      expect(daPagina.channelName).toBeTruthy();
    });

    test('countCampaigns conta todas, independente da pagina', async () => {
      await tresCampanhas();
      expect(await countCampaigns()).toBe(3);
      await listCampaigns({ limit: 1, offset: 0 });
      expect(await countCampaigns()).toBe(3);
    });

    test('countCampaigns devolve zero quando nao ha campanha', async () => {
      expect(await countCampaigns()).toBe(0);
    });
  });

  test('createCampaignRecipients inserts every recipient with the given status', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const campaign = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 2 });

    const recipients = await createCampaignRecipients(campaign.id, [
      { rawPhoneNumber: '5511999990000', phoneNumber: '5511999990000', displayName: 'Joao', status: 'pending' },
      { rawPhoneNumber: 'abc', phoneNumber: '', displayName: null, status: 'failed', errorMessage: 'Numero invalido' },
    ]);

    expect(recipients).toHaveLength(2);
    expect(recipients[0].status).toBe('pending');
    expect(recipients[0].displayName).toBe('Joao');
    expect(recipients[1].status).toBe('failed');
    expect(recipients[1].errorMessage).toBe('Numero invalido');

    const listed = await listCampaignRecipients(campaign.id);
    expect(listed).toHaveLength(2);
  });

  test('updateCampaignRecipientStatus updates status, error and links', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const campaign = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1 });
    const [recipient] = await createCampaignRecipients(campaign.id, [
      { rawPhoneNumber: '5511999990000', phoneNumber: '5511999990000', displayName: null },
    ]);
    const contact = await findOrCreateContactByPhoneNumber('5511999990000', null);
    const conversation = await createConversation(contact.id, channel.id);

    const updated = await updateCampaignRecipientStatus(recipient.id, {
      status: 'sent',
      contactId: contact.id,
      conversationId: conversation.id,
    });

    expect(updated.status).toBe('sent');
    expect(updated.contactId).toBe(contact.id);
    expect(updated.conversationId).toBe(conversation.id);
    expect(updated.processedAt).not.toBeNull();
  });

  test('incrementCampaignCounter increments the right counter', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const campaign = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 5 });

    await incrementCampaignCounter(campaign.id, 'sent');
    await incrementCampaignCounter(campaign.id, 'sent');
    await incrementCampaignCounter(campaign.id, 'failed', 3);

    const updated = await findCampaignById(campaign.id);
    expect(updated.sentCount).toBe(2);
    expect(updated.failedCount).toBe(3);
    expect(updated.skippedCount).toBe(0);
  });

  test('deleteCampaign removes the campaign row', async () => {
    const agent = await makeAgent();
    const channel = await makeChannel();
    const campaign = await createCampaign({ channelId: channel.id, messageType: 'text', content: 'a', createdBy: agent.id, totalRecipients: 1 });

    await deleteCampaign(campaign.id);

    expect(await findCampaignById(campaign.id)).toBeNull();
  });
});
