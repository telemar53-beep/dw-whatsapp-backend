// Passo seguinte (regra do BUG-006), no banco de teste de verdade: não basta o disparo
// escolher um contato — a RESPOSTA do cliente, que chega com o wa_id da Meta, tem de cair na
// mesma conversa do disparo. Fase 1A (25/09/2026): em produção, 220 pares mostraram o
// disparo no contato com o 9 e a resposta no contato sem o 9.
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { renameGhostContactToWaId, setContactSgpLink } = require('./contact.repository');
const { createConversation, findOpenConversation, claimConversation, closeConversation } = require('./conversation.repository');
const { createAgent } = require('../agents/agent.repository');
const { updateContact } = require('./contact.repository');
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

  // Um teste que falha antes do mockRestore não pode deixar o espião de console.warn para o seguinte.
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await closePool();
  });

  // O que a rota do SGP faz com o contato escolhido (integrations-sgp.routes.js).
  async function disparar(telefoneDoSgp) {
    const contato = await resolverContatoDoDisparo(telefoneDoSgp, null, canal.id);
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

  // ---- Revisão da Fase 1A (25/09/2026): os 6 pares ambíguos de produção ----
  // Nos 6, o lado com 9 tinha 0 entrada, sem SGP e sem nota: só conversas antigas de atendente
  // com saída. A escolha entre as formas passa a usar EVIDÊNCIA FORTE (entrada, vínculo SGP,
  // nota). Nada existente é movido nem apagado; a renomeação continua pela régua de histórico.

  let agenteSeq = 0;
  async function atendente() {
    agenteSeq += 1;
    return createAgent({ name: 'Atendente', email: `atendente-1a-${Date.now()}-${agenteSeq}@teste.local`, password: 'segredo123', role: 'agent' });
  }

  // Conversa antiga que a atendente abriu, assumiu, mandou mensagem e encerrou, sem resposta.
  async function atendimentoSoDeSaida(contatoId, canalId, agente) {
    const conv = await createConversation(contatoId, canalId);
    await claimConversation(conv.id, agente.id);
    await createMessage({ conversationId: conv.id, direction: 'outbound', content: 'teste da atendente', status: 'read', messageType: 'text', sentBy: 'human' });
    await closeConversation(conv.id, agente.id, null);
    return conv;
  }

  async function comEntradas(contatoId, canalId, n, status = 'closed') {
    const conv = await createConversation(contatoId, canalId, null, status);
    for (let i = 0; i < n; i += 1) {
      await createMessage({ conversationId: conv.id, direction: 'inbound', content: 'oi', status: 'received', messageType: 'text' });
    }
    return conv;
  }

  const retrato = async (contatoId) => (await getPool().query(
    `SELECT c.id, c.status, c.contact_id, (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS msgs
       FROM conversations c WHERE c.contact_id = $1 ORDER BY c.id`, [contatoId])).rows;

  test('CASO 1 — o par do teste de hoje: novo disparo com 9 vai para o contato sem 9; o com 9 e as conversas dele ficam intactos', async () => {
    const agente = await atendente();
    const canal360 = await createChannel({ type: '360dialog', name: '360 antigo', phoneNumber: '+5511990004444', config: {} });

    // COM 9: duas conversas antigas de atendente no 360dialog (closed, só saída) + silent de disparo na Meta.
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoSoDeSaida(c9.id, canal360.id, agente);
    await atendimentoSoDeSaida(c9.id, canal360.id, agente);
    const silentAntiga = await createConversation(c9.id, canal.id, null, 'silent');
    await createMessage({ conversationId: silentAntiga.id, direction: 'outbound', content: null, status: 'read', messageType: 'text' });

    // SEM 9: muitas entradas, vínculo SGP, conversa aberta na Meta.
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, 'Real');
    await setContactSgpLink(s9.id, { sgpClientId: 1, sgpContractId: 2, sgpDocument: '52998224725', sgpFirstName: 'Real' });
    await comEntradas(s9.id, canal360.id, 20);
    const abertaMeta = await comEntradas(s9.id, canal.id, 3, 'waiting');

    const antesC9 = await retrato(c9.id);
    const antesS9 = await retrato(s9.id);
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { contato, conversa } = await disparar(COM9);

    expect(contato.id).toBe(s9.id);
    expect(conversa.id).toBe(abertaMeta.id); // entra na conversa aberta do contato real
    expect(spy).not.toHaveBeenCalled(); // não é mais ambíguo
    spy.mockRestore();
    // O com 9 fica exatamente como estava: número, conversas, status e mensagens.
    expect((await getPool().query('SELECT phone_number FROM contacts WHERE id = $1', [c9.id])).rows[0].phone_number).toBe(COM9);
    expect(await retrato(c9.id)).toEqual(antesC9);
    // O sem 9 ganhou só a mensagem do disparo, na conversa aberta.
    const depoisS9 = await retrato(s9.id);
    expect(depoisS9.map((c) => c.id)).toEqual(antesS9.map((c) => c.id));
    expect(depoisS9.find((c) => c.id === abertaMeta.id).msgs).toBe(antesS9.find((c) => c.id === abertaMeta.id).msgs + 1);
    // Nenhum contato criado nem apagado; a resposta pelo wa_id cai na conversa do disparo.
    expect(await contar('SELECT count(*)::int AS n FROM contacts', [])).toBe(2);
    expect((await responder(SEM9)).id).toBe(conversa.id);
  });

  test('CASO 2 — com 9 só com saída de atendente, sem 9 com entrada: escolhe o sem 9', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoSoDeSaida(c9.id, canal.id, agente);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await comEntradas(s9.id, canal.id, 1);

    expect((await disparar(COM9)).contato.id).toBe(s9.id);
  });

  test('CASO 3 — com 9 com entrada, sem 9 só com saída: escolhe o com 9 (também quando o SGP manda sem 9)', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await comEntradas(c9.id, canal.id, 1);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await atendimentoSoDeSaida(s9.id, canal.id, agente);

    expect((await resolverContatoDoDisparo(COM9)).id).toBe(c9.id);
    expect((await resolverContatoDoDisparo(SEM9)).id).toBe(c9.id);
  });

  test('CASO 4 — as duas com entrada: continua ambíguo, não escolhe (fica o número do SGP) e registra', async () => {
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await comEntradas(c9.id, canal.id, 1);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await comEntradas(s9.id, canal.id, 1);
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await resolverContatoDoDisparo(COM9)).id).toBe(c9.id);
    expect((await resolverContatoDoDisparo(SEM9)).id).toBe(s9.id);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test('CASO 5 — um só com vínculo SGP, o outro só com saída: escolhe o do vínculo', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoSoDeSaida(c9.id, canal.id, agente);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await setContactSgpLink(s9.id, { sgpClientId: 1, sgpContractId: null, sgpDocument: '52998224725', sgpFirstName: 'Ana' });

    expect((await resolverContatoDoDisparo(COM9)).id).toBe(s9.id);
  });

  test('CASO 5b — nota interna também decide', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoSoDeSaida(c9.id, canal.id, agente);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await updateContact(s9.id, { internalNote: 'cliente da rua 2' });

    expect((await resolverContatoDoDisparo(COM9)).id).toBe(s9.id);
  });

  test('CASO 6 — as duas só com saída (sem entrada, SGP ou nota): conservador, fica o número do SGP e nada se move', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoSoDeSaida(c9.id, canal.id, agente);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await atendimentoSoDeSaida(s9.id, canal.id, agente);
    const antes = [await retrato(c9.id), await retrato(s9.id)];

    expect((await resolverContatoDoDisparo(COM9)).id).toBe(c9.id);
    expect((await resolverContatoDoDisparo(SEM9)).id).toBe(s9.id);
    expect([await retrato(c9.id), await retrato(s9.id)]).toEqual(antes);
  });

  test('CASO 7 — renomeação intacta: o com 9 do caso real, sozinho, não passa ao wa_id (tem histórico, mesmo sem evidência forte)', async () => {
    const agente = await atendente();
    const canal360 = await createChannel({ type: '360dialog', name: '360 antigo', phoneNumber: '+5511990005555', config: {} });
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoSoDeSaida(c9.id, canal360.id, agente);
    await atendimentoSoDeSaida(c9.id, canal360.id, agente);

    // Só a forma com 9 existe: o disparo vai para ela, e a Meta devolve o wa_id sem 9.
    const { contato, mensagem } = await disparar(COM9);
    expect(contato.id).toBe(c9.id);
    expect(await renameGhostContactToWaId(c9.id, COM9, SEM9, mensagem.id)).toBe(false);
    expect((await getPool().query('SELECT phone_number FROM contacts WHERE id = $1', [c9.id])).rows[0].phone_number).toBe(COM9);
  });

  // ---- Ajuste antes do merge (25/09/2026): preferência de ROTEAMENTO por conversa aberta ----
  // Sem evidência forte em nenhum lado, se EXATAMENTE um tem conversa aberta (waiting/assigned)
  // no canal do disparo, o disparo vai para ele, para não dividir uma conversa já aberta. Não é
  // identidade: silent e closed não contam, e aberta em outro canal não puxa o disparo.

  // Conversa que a atendente abriu e assumiu, com mensagem de saída, ainda ABERTA.
  async function atendimentoAberto(contatoId, canalId, agente) {
    const conv = await createConversation(contatoId, canalId);
    await claimConversation(conv.id, agente.id);
    await createMessage({ conversationId: conv.id, direction: 'outbound', content: 'teste da atendente', status: 'read', messageType: 'text', sentBy: 'human' });
    return conv;
  }

  async function fantasmaSilent(telefone) {
    const f = await findOrCreateContactByPhoneNumber(telefone, null);
    const silent = await createConversation(f.id, canal.id, null, 'silent');
    await createMessage({ conversationId: silent.id, direction: 'outbound', content: null, status: 'read', messageType: 'text' });
    return { f, silent };
  }

  test('PREF A — só o sem 9 com conversa aberta no canal (o com 9 só com silent de disparo): escolhe o sem 9, na conversa aberta', async () => {
    const agente = await atendente();
    const { f: c9, silent } = await fantasmaSilent(COM9);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    const aberta = await atendimentoAberto(s9.id, canal.id, agente);
    const antesC9 = await retrato(c9.id);

    const { contato, conversa } = await disparar(COM9);

    expect(contato.id).toBe(s9.id);
    expect(conversa.id).toBe(aberta.id);
    expect(await retrato(c9.id)).toEqual(antesC9); // com 9 e a silent dele intactos
    expect((await getPool().query('SELECT status FROM conversations WHERE id = $1', [silent.id])).rows[0].status).toBe('silent');
    expect((await responder(SEM9)).id).toBe(aberta.id);
  });

  test('PREF B — só o com 9 com conversa aberta no canal: escolhe o com 9, mesmo com o SGP mandando sem 9', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    const aberta = await atendimentoAberto(c9.id, canal.id, agente);
    await fantasmaSilent(SEM9);

    const { contato, conversa } = await disparar(SEM9);

    expect(contato.id).toBe(c9.id);
    expect(conversa.id).toBe(aberta.id);
  });

  test('PREF C — conversa só ENCERRADA num lado não é preferência: fica o número do SGP', async () => {
    const agente = await atendente();
    const { f: c9 } = await fantasmaSilent(COM9);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await atendimentoSoDeSaida(s9.id, canal.id, agente);

    expect((await disparar(COM9)).contato.id).toBe(c9.id);
  });

  test('PREF D — conversa aberta nos dois lados: conservador, fica o número do SGP (nos dois sentidos)', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoAberto(c9.id, canal.id, agente);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await atendimentoAberto(s9.id, canal.id, agente);

    expect((await resolverContatoDoDisparo(COM9, null, canal.id)).id).toBe(c9.id);
    expect((await resolverContatoDoDisparo(SEM9, null, canal.id)).id).toBe(s9.id);
  });

  test('PREF E — conversa aberta só em OUTRO canal não puxa o disparo deste canal', async () => {
    const agente = await atendente();
    const outroCanal = await createChannel({ type: '360dialog', name: '360 outro', phoneNumber: '+5511990006666', config: {} });
    const { f: c9 } = await fantasmaSilent(COM9);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await atendimentoAberto(s9.id, outroCanal.id, agente);

    expect((await disparar(COM9)).contato.id).toBe(c9.id);
  });

  test('PREF — conversa aberta não é identidade: o lado com entrada ganha do lado com conversa aberta', async () => {
    const agente = await atendente();
    const c9 = await findOrCreateContactByPhoneNumber(COM9, null);
    await atendimentoAberto(c9.id, canal.id, agente);
    const s9 = await findOrCreateContactByPhoneNumber(SEM9, null);
    await comEntradas(s9.id, canal.id, 1);

    expect((await disparar(COM9)).contato.id).toBe(s9.id);
  });
});
