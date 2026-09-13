const { getPool, closePool } = require('../db/pool');
const {
  listActiveReasons,
  listAllReasons,
  findReasonById,
  createReason,
  updateReason,
} = require('./reason.repository');

// A coluna nova ai_config.triage_resolved_reason_id referencia contact_reasons,
// e TRUNCATE ... CASCADE leva junto TODA tabela que referencia a truncada —
// inclusive a linha singleton de ai_config, semeada pela migração e esperada
// de pé por outras suítes (o banco de teste é um só, compartilhado). Guarda e
// repõe; o motivo de encerramento volta nulo, que é o default da coluna.
async function truncarPreservandoAiConfig(sql) {
  const { rows } = await getPool().query('SELECT * FROM ai_config WHERE id = 1');
  await getPool().query(sql);
  if (rows.length === 0) return;
  const linha = { ...rows[0], triage_resolved_reason_id: null };
  const colunas = Object.keys(linha);
  await getPool().query(
    `INSERT INTO ai_config (${colunas.join(', ')})
     VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (id) DO NOTHING`,
    colunas.map((c) => linha[c])
  );
}

describe('reason repository', () => {
  beforeEach(async () => {
    await truncarPreservandoAiConfig('TRUNCATE contact_reasons CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createReason stores and returns a reason, active by default', async () => {
    const reason = await createReason({ name: 'Troca de senha' });
    expect(reason.id).toBeDefined();
    expect(reason.name).toBe('Troca de senha');
    expect(reason.active).toBe(true);
    expect(reason.createdAt).toBeDefined();
  });

  test('listActiveReasons returns an empty array when there are none', async () => {
    expect(await listActiveReasons()).toEqual([]);
  });

  test('listActiveReasons excludes inactive reasons but listAllReasons includes them', async () => {
    const active = await createReason({ name: 'Ativo' });
    const inactive = await createReason({ name: 'Inativo' });
    await updateReason(inactive.id, { active: false });

    const activeOnly = await listActiveReasons();
    const all = await listAllReasons();

    expect(activeOnly.map((r) => r.id)).toEqual([active.id]);
    expect(all.map((r) => r.id).sort()).toEqual([active.id, inactive.id].sort());
  });

  test('listAllReasons orders by name ascending', async () => {
    await createReason({ name: 'Zebra' });
    await createReason({ name: 'Abelha' });

    const reasons = await listAllReasons();

    expect(reasons.map((r) => r.name)).toEqual(['Abelha', 'Zebra']);
  });

  test('findReasonById returns the reason', async () => {
    const created = await createReason({ name: 'Pagamento' });
    const found = await findReasonById(created.id);
    expect(found.id).toBe(created.id);
    expect(found.name).toBe('Pagamento');
  });

  test('findReasonById returns null when the id does not exist', async () => {
    expect(await findReasonById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('updateReason updates only the name when active is not passed', async () => {
    const reason = await createReason({ name: 'Original' });

    const updated = await updateReason(reason.id, { name: 'Editado' });

    expect(updated.name).toBe('Editado');
    expect(updated.active).toBe(true);
  });

  test('updateReason updates only active when name is not passed', async () => {
    const reason = await createReason({ name: 'Original' });

    const updated = await updateReason(reason.id, { active: false });

    expect(updated.name).toBe('Original');
    expect(updated.active).toBe(false);
  });

  test('updateReason updates both fields when both are passed', async () => {
    const reason = await createReason({ name: 'Original' });

    const updated = await updateReason(reason.id, { name: 'Editado', active: false });

    expect(updated.name).toBe('Editado');
    expect(updated.active).toBe(false);
  });

  test('updateReason returns null when the id does not exist', async () => {
    const updated = await updateReason('00000000-0000-0000-0000-000000000000', { name: 'X' });
    expect(updated).toBeNull();
  });
});
