const { getPool, closePool } = require('../db/pool');
const { recordTrustUnlock, listTrustUnlocksByContract, hasRecentTrustUnlockByContact } = require('./trust-unlock.repository');

describe('trust-unlock repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_trust_unlocks');
  });

  afterAll(async () => { await closePool(); });

  test('grava uma liberação e a relê pelo contrato, mais recente primeiro', async () => {
    const a = await recordTrustUnlock({ contactId: null, contractId: 26515, protocolo: '111', liberadoDias: 3 });
    expect(a.contractId).toBe(26515);
    expect(a.protocolo).toBe('111');
    expect(a.liberadoDias).toBe(3);
    expect(a.createdAt).toBeInstanceOf(Date);

    await getPool().query("UPDATE ai_trust_unlocks SET created_at = now() - interval '40 days' WHERE id = $1", [a.id]);
    const b = await recordTrustUnlock({ contactId: null, contractId: 26515, protocolo: '222', liberadoDias: 2 });

    const lista = await listTrustUnlocksByContract(26515);
    expect(lista.map((l) => l.protocolo)).toEqual(['222', '111']);
    expect(lista[0].id).toBe(b.id);
  });

  test('não mistura contratos', async () => {
    await recordTrustUnlock({ contactId: null, contractId: 1, protocolo: 'x', liberadoDias: 1 });
    expect(await listTrustUnlocksByContract(2)).toEqual([]);
  });

  test('aceita protocolo e dias ausentes', async () => {
    const r = await recordTrustUnlock({ contactId: null, contractId: 3 });
    expect(r.protocolo).toBeNull();
    expect(r.liberadoDias).toBeNull();
  });
});

// O verificador de afirmações do orquestrador (Task 4) precisa saber se ESTE
// contato foi liberado há pouco, mesmo que tenha sido em outro turno: sem isso
// ele obriga a IA a dizer "não consegui liberar" sobre uma liberação que houve.
describe('hasRecentTrustUnlockByContact', () => {
  let contatoA;
  let contatoB;

  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_trust_unlocks, contacts CASCADE');
    const a = await getPool().query("INSERT INTO contacts (phone_number) VALUES ('5598999990001') RETURNING id");
    const b = await getPool().query("INSERT INTO contacts (phone_number) VALUES ('5598999990002') RETURNING id");
    contatoA = a.rows[0].id;
    contatoB = b.rows[0].id;
  });

  const UM_DIA = 24 * 60 * 60 * 1000;

  test('acha a liberação do contato dentro da janela', async () => {
    await recordTrustUnlock({ contactId: contatoA, contractId: 26515, protocolo: '111', liberadoDias: 3 });
    expect(await hasRecentTrustUnlockByContact(contatoA, UM_DIA)).toBe(true);
  });

  test('não acha a liberação que ficou fora da janela', async () => {
    const r = await recordTrustUnlock({ contactId: contatoA, contractId: 26515, protocolo: '111', liberadoDias: 3 });
    await getPool().query("UPDATE ai_trust_unlocks SET created_at = now() - interval '2 days' WHERE id = $1", [r.id]);
    expect(await hasRecentTrustUnlockByContact(contatoA, UM_DIA)).toBe(false);
  });

  test('não acha a liberação de outro contato', async () => {
    await recordTrustUnlock({ contactId: contatoB, contractId: 26515, protocolo: '111', liberadoDias: 3 });
    expect(await hasRecentTrustUnlockByContact(contatoA, UM_DIA)).toBe(false);
  });

  test('sem contato não consulta nada e responde false', async () => {
    // Liberação gravada sem contato (contact_id nulo) não pode casar com
    // "qualquer um": quem chama pode não ter id de contato no turno.
    await recordTrustUnlock({ contactId: null, contractId: 26515, protocolo: '111', liberadoDias: 3 });
    expect(await hasRecentTrustUnlockByContact(null, UM_DIA)).toBe(false);
    expect(await hasRecentTrustUnlockByContact(undefined, UM_DIA)).toBe(false);
  });
});
