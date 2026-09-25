// Passo seguinte (regra do BUG-006), no banco de teste de verdade: não basta o disparo
// escolher um contato — a RESPOSTA do cliente, que chega com o wa_id da Meta, tem de cair na
// mesma conversa do disparo. Fase 1A (25/09/2026): em produção, 220 pares mostraram o
// disparo no contato com o 9 e a resposta no contato sem o 9.
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { renameGhostContactToWaId, setContactSgpLink } = require('./contact.repository');
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
    expect(await renameGhostContactToWaId(contato.id, COM9, SEM9, mensagem.id)).toBe(true);

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

  // ---- Obrigatórios da revisão antes do merge (regra revista em 25/09/2026) ----

  const contar = async (sql, params) => (await getPool().query(sql, params)).rows[0].n;
  const mensagensDoContato = (id) => contar('SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.contact_id = $1', [id]);
  const conversasDoContato = (id) => contar('SELECT count(*)::int AS n FROM conversations WHERE contact_id = $1', [id]);

  async function fantasmaAntigo(disparosAntigos) {
    const a = await findOrCreateContactByPhoneNumber(COM9, null);
    const silent = await createConversation(a.id, canal.id, null, 'silent');
    for (let i = 0; i < disparosAntigos; i += 1) {
      await createMessage({ conversationId: silent.id, direction: 'outbound', content: null, status: 'sent', messageType: 'text' });
    }
    return { a, silent };
  }

  test('OBRIGATÓRIO 1 — fantasma A (com 9) + contato real B (sem 9): novo disparo usa B; A e a silent antiga de A ficam intactos', async () => {
    const { a, silent } = await fantasmaAntigo(1);
    const b = await findOrCreateContactByPhoneNumber(SEM9, 'Real');
    const fechada = await createConversation(b.id, canal.id, null, 'closed');
    await createMessage({ conversationId: fechada.id, direction: 'inbound', content: 'oi', status: 'received', messageType: 'text' });

    const { contato, conversa } = await disparar(COM9);

    expect(contato.id).toBe(b.id);
    expect(conversa.id).not.toBe(silent.id);
    // A intacto: mesmo número, mesma silent, mesma única mensagem.
    const aDepois = (await getPool().query('SELECT phone_number FROM contacts WHERE id = $1', [a.id])).rows[0];
    expect(aDepois.phone_number).toBe(COM9);
    expect((await getPool().query('SELECT status FROM conversations WHERE id = $1', [silent.id])).rows[0].status).toBe('silent');
    expect(await contar('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [silent.id])).toBe(1);
    // A resposta pelo wa_id cai na conversa do disparo, em B.
    expect((await responder(SEM9)).id).toBe(conversa.id);
  });

  test('OBRIGATÓRIO 2 — fantasma sozinho antigo: o MESMO contato passa ao wa_id, com conversas e mensagens intactas, e a resposta encontra a conversa do disparo', async () => {
    const { a, silent } = await fantasmaAntigo(3);
    // Uma segunda conversa silent de disparo, noutro canal ("conversa(s)").
    const outroCanal = await createChannel({ type: 'meta_cloud', name: 'Meta 2', phoneNumber: '+5511990003333', config: {} });
    const silentOutroCanal = await createConversation(a.id, outroCanal.id, null, 'silent');
    await createMessage({ conversationId: silentOutroCanal.id, direction: 'outbound', content: null, status: 'sent', messageType: 'text' });
    const conversasAntes = await conversasDoContato(a.id);

    // Novo template: a rota escolhe A (única forma existente) e reusa a MESMA silent.
    const { contato, conversa, mensagem } = await disparar(COM9);
    expect(contato.id).toBe(a.id);
    expect(conversa.id).toBe(silent.id);

    // A Meta devolve o wa_id sem 9: o worker normaliza o número do MESMO contato.
    expect(await renameGhostContactToWaId(a.id, COM9, SEM9, mensagem.id)).toBe(true);

    const { rows } = await getPool().query('SELECT id, phone_number FROM contacts WHERE phone_number = ANY($1::text[])', [[COM9, SEM9]]);
    expect(rows).toEqual([{ id: a.id, phone_number: SEM9 }]); // nenhuma linha duplicada
    expect(await conversasDoContato(a.id)).toBe(conversasAntes); // conversas continuam no mesmo contact_id
    expect(await mensagensDoContato(a.id)).toBe(3 + 1 + 1); // 3 antigos + 1 no outro canal + o novo disparo
    expect((await getPool().query('SELECT status FROM conversations WHERE id = $1', [silent.id])).rows[0].status).toBe('silent');

    // A resposta pelo wa_id encontra esse contato e essa conversa; o disparo segue no histórico dela.
    const contatoDaResposta = await findOrCreateContactByPhoneNumber(SEM9, null);
    expect(contatoDaResposta.id).toBe(a.id);
    const conversaDaResposta = await findOpenConversation(a.id, canal.id);
    expect(conversaDaResposta.id).toBe(silent.id);
    expect(await contar('SELECT count(*)::int AS n FROM messages WHERE id = $1 AND conversation_id = $2', [mensagem.id, silent.id])).toBe(1);
  });

  test('OBRIGATÓRIO 3 (negativo) — com qualquer histórico próprio, não renomeia automaticamente', async () => {
    const { a } = await fantasmaAntigo(2);
    await setContactSgpLink(a.id, { sgpClientId: 1, sgpContractId: null, sgpDocument: '52998224725', sgpFirstName: 'Ana' });
    const { mensagem } = await disparar(COM9);

    expect(await renameGhostContactToWaId(a.id, COM9, SEM9, mensagem.id)).toBe(false);
    expect((await getPool().query('SELECT phone_number FROM contacts WHERE id = $1', [a.id])).rows[0].phone_number).toBe(COM9);
  });

  test('OBRIGATÓRIO 4 (negativo) — outro contato já com o wa_id: não renomeia, não une, não move conversa', async () => {
    const { a, silent } = await fantasmaAntigo(2);
    const b = await findOrCreateContactByPhoneNumber(SEM9, null); // existe, sem histórico próprio
    const conversasB = await conversasDoContato(b.id);

    // B existe mas também não tem histórico: dois fantasmas, a rota mantém o número do SGP (A).
    const { contato, mensagem } = await disparar(COM9);
    expect(contato.id).toBe(a.id);

    expect(await renameGhostContactToWaId(a.id, COM9, SEM9, mensagem.id)).toBe(false);
    const { rows } = await getPool().query('SELECT id, phone_number FROM contacts ORDER BY phone_number');
    expect(rows).toEqual([{ id: b.id, phone_number: SEM9 }, { id: a.id, phone_number: COM9 }]);
    expect(await conversasDoContato(b.id)).toBe(conversasB);
    expect(await contar('SELECT count(*)::int AS n FROM conversations WHERE id = $1 AND contact_id = $2', [silent.id, a.id])).toBe(1);
  });
});
