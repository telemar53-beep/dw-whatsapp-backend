// Passo seguinte (regra do BUG-006), no banco de teste de verdade: não basta o disparo
// escolher um contato — a RESPOSTA do cliente, que chega com o wa_id da Meta, tem de cair na
// mesma conversa do disparo. Fase 1A (25/09/2026): em produção, 220 pares mostraram o
// disparo no contato com o 9 e a resposta no contato sem o 9.
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { renameFreshDispatchContactToWaId } = require('./contact.repository');
const { createConversation, findOpenConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { resolverContatoDoDisparo } = require('./dispatch-contact');

const COM9 = '5598985120338'; // como o SGP manda
const SEM9 = '559885120338';  // como a Meta devolve (wa_id) e como a resposta chega

describe('Fase 1A — disparo e resposta do mesmo celular na mesma conversa', () => {
  let canal;

  beforeEach(async () => {
    await getPool().query('TRUNCATE channels, contacts, cities CASCADE');
    canal = await createChannel({ type: 'meta_cloud', name: 'Meta Fase 1A', phoneNumber: '+5511990001111', config: {} });
  });

  afterAll(async () => {
    await closePool();
  });

  // O que a rota do SGP faz com o contato escolhido (integrations-sgp.routes.js).
  async function disparar(telefoneDoSgp) {
    const contato = await resolverContatoDoDisparo(telefoneDoSgp);
    let conversa = await findOpenConversation(contato.id, canal.id);
    if (!conversa) conversa = await createConversation(contato.id, canal.id, null, 'silent');
    const mensagem = await createMessage({ conversationId: conversa.id, direction: 'outbound', content: null, status: 'sent', messageType: 'text' });
    return { contato, conversa, mensagem };
  }

  // O que a entrada faz com a resposta (inbound-message.service.js): contato pelo número exato.
  async function responder(waId) {
    const contato = await findOrCreateContactByPhoneNumber(waId, null);
    return findOpenConversation(contato.id, canal.id);
  }

  test('cliente real já conhecido pelo wa_id sem 9: disparo e resposta na mesma conversa', async () => {
    const real = await findOrCreateContactByPhoneNumber(SEM9, 'Ana');
    const antiga = await createConversation(real.id, canal.id, null, 'closed');
    await createMessage({ conversationId: antiga.id, direction: 'inbound', content: 'oi', status: 'received', messageType: 'text' });

    const { contato, conversa } = await disparar(COM9);
    const conversaDaResposta = await responder(SEM9);

    expect(contato.id).toBe(real.id);
    expect(conversaDaResposta.id).toBe(conversa.id);
    // Nenhum contato fantasma com o 9 foi criado.
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM contacts WHERE phone_number = $1', [COM9]);
    expect(rows[0].n).toBe(0);
  });

  test('número nunca visto: o contato nasce com o número do SGP e passa ao wa_id devolvido pela Meta; a resposta cai na conversa do disparo', async () => {
    const { contato, conversa, mensagem } = await disparar(COM9);
    expect(contato.phoneNumber).toBe(COM9);

    // O worker de saída recebe o wa_id no envio do template e faz a troca segura.
    expect(await renameFreshDispatchContactToWaId(contato.id, SEM9, mensagem.id)).toBe(true);

    const conversaDaResposta = await responder(SEM9);
    expect(conversaDaResposta.id).toBe(conversa.id);
  });

  test('duas formas com histórico próprio: não une, não escolhe — o disparo fica com o número do SGP', async () => {
    const a = await findOrCreateContactByPhoneNumber(COM9, 'A');
    await createMessage({ conversationId: (await createConversation(a.id, canal.id, null, 'closed')).id, direction: 'inbound', content: 'oi', status: 'received', messageType: 'text' });
    const b = await findOrCreateContactByPhoneNumber(SEM9, 'B');
    await createMessage({ conversationId: (await createConversation(b.id, canal.id, null, 'closed')).id, direction: 'inbound', content: 'oi', status: 'received', messageType: 'text' });
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { contato } = await disparar(COM9);

    expect(contato.id).toBe(a.id);
    const { rows } = await getPool().query('SELECT phone_number FROM contacts ORDER BY phone_number');
    expect(rows.map((r) => r.phone_number)).toEqual([SEM9, COM9]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
