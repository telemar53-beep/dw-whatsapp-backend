const { getPool, closePool } = require('../db/pool');
const {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
} = require('./template.repository');

beforeEach(async () => {
  await getPool().query('TRUNCATE message_templates');
});

afterAll(async () => {
  await closePool();
});

describe('createTemplateRecord', () => {
  test('creates a template with status PENDING and the given fields', async () => {
    const template = await createTemplateRecord({
      wabaId: 'waba-1',
      metaTemplateId: 'meta-tpl-1',
      name: 'fatura_vencida',
      language: 'pt_BR',
      category: 'UTILITY',
      bodyText: 'Olá {{1}}, sua fatura de {{2}} venceu.',
      variableCount: 2,
    });

    expect(template).toEqual({
      id: expect.any(String),
      wabaId: 'waba-1',
      metaTemplateId: 'meta-tpl-1',
      name: 'fatura_vencida',
      language: 'pt_BR',
      category: 'UTILITY',
      bodyText: 'Olá {{1}}, sua fatura de {{2}} venceu.',
      variableCount: 2,
      status: 'PENDING',
      rejectionReason: null,
      createdAt: expect.any(Date),
    });
  });

  test('rejects a duplicate (wabaId, name, language) combination', async () => {
    await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-tpl-1', name: 'fatura_vencida', language: 'pt_BR',
      category: 'UTILITY', bodyText: 'Corpo', variableCount: 0,
    });
    await expect(
      createTemplateRecord({
        wabaId: 'waba-1', metaTemplateId: 'meta-tpl-2', name: 'fatura_vencida', language: 'pt_BR',
        category: 'UTILITY', bodyText: 'Outro corpo', variableCount: 0,
      })
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('listTemplates and listApprovedTemplatesByWabaId', () => {
  test('listTemplates returns every template regardless of status, newest first', async () => {
    const first = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-1', name: 'a', language: 'pt_BR', category: 'UTILITY', bodyText: 'A', variableCount: 0,
    });
    const second = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-2', name: 'b', language: 'pt_BR', category: 'MARKETING', bodyText: 'B', variableCount: 0,
    });
    const all = await listTemplates();
    expect(all.map((t) => t.id)).toEqual([second.id, first.id]);
  });

  test('listApprovedTemplatesByWabaId only returns APPROVED templates for that WABA', async () => {
    const approved = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-1', name: 'approved_one', language: 'pt_BR', category: 'UTILITY', bodyText: 'A', variableCount: 0,
    });
    await updateTemplateStatusByMetaTemplateId('meta-1', { status: 'APPROVED', rejectionReason: null });
    await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-2', name: 'pending_one', language: 'pt_BR', category: 'UTILITY', bodyText: 'B', variableCount: 0,
    });
    await createTemplateRecord({
      wabaId: 'waba-2', metaTemplateId: 'meta-3', name: 'other_waba_approved', language: 'pt_BR', category: 'UTILITY', bodyText: 'C', variableCount: 0,
    });
    await updateTemplateStatusByMetaTemplateId('meta-3', { status: 'APPROVED', rejectionReason: null });

    const result = await listApprovedTemplatesByWabaId('waba-1');
    expect(result.map((t) => t.id)).toEqual([approved.id]);
  });
});

describe('findTemplateById and findTemplateByMetaTemplateId', () => {
  test('findTemplateById returns null for a missing id', async () => {
    expect(await findTemplateById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('findTemplateByMetaTemplateId finds a template by its Meta-assigned id', async () => {
    const created = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-xyz', name: 'x', language: 'pt_BR', category: 'UTILITY', bodyText: 'X', variableCount: 0,
    });
    const found = await findTemplateByMetaTemplateId('meta-xyz');
    expect(found.id).toBe(created.id);
  });

  test('findTemplateByMetaTemplateId returns null when no template matches', async () => {
    expect(await findTemplateByMetaTemplateId('does-not-exist')).toBeNull();
  });
});

describe('updateTemplateStatusByMetaTemplateId', () => {
  test('updates status and rejection reason', async () => {
    await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-r1', name: 'r1', language: 'pt_BR', category: 'UTILITY', bodyText: 'R', variableCount: 0,
    });
    const updated = await updateTemplateStatusByMetaTemplateId('meta-r1', { status: 'REJECTED', rejectionReason: 'Sample content mismatch' });
    expect(updated.status).toBe('REJECTED');
    expect(updated.rejectionReason).toBe('Sample content mismatch');
  });

  test('returns null when no template matches the given metaTemplateId', async () => {
    expect(await updateTemplateStatusByMetaTemplateId('nope', { status: 'APPROVED', rejectionReason: null })).toBeNull();
  });
});

describe('deleteTemplateRecord', () => {
  test('deletes an existing template and returns true', async () => {
    const created = await createTemplateRecord({
      wabaId: 'waba-1', metaTemplateId: 'meta-d1', name: 'd1', language: 'pt_BR', category: 'UTILITY', bodyText: 'D', variableCount: 0,
    });
    expect(await deleteTemplateRecord(created.id)).toBe(true);
    expect(await findTemplateById(created.id)).toBeNull();
  });

  test('returns false when the id does not exist', async () => {
    expect(await deleteTemplateRecord('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
