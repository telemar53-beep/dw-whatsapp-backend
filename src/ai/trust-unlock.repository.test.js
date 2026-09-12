const { getPool, closePool } = require('../db/pool');
const { recordTrustUnlock, listTrustUnlocksByContract } = require('./trust-unlock.repository');

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
