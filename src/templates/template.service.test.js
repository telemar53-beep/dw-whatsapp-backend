jest.mock('../channels/channel.repository');
jest.mock('./template.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');
jest.mock('../whatsapp-adapters/three-sixty-dialog.adapter');

const { findChannelById, findChannelByWabaId } = require('../channels/channel.repository');
const {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
} = require('./template.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const {
  createTemplate,
  listApprovedTemplatesForChannel,
  deleteTemplate,
  syncTemplatesForWaba,
  applyTemplateStatusUpdates,
  registerExistingTemplate,
  TemplateValidationError,
} = require('./template.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createTemplate', () => {
  // O corpo tem {{1}} e a fixture nao trazia exemplo nenhum — exatamente a
  // combinacao que a Meta aceita na criacao e reprova na revisao com
  // INVALID_FORMAT. Alinhar a fixture ao que passa na revisao nao afrouxa o
  // teste: era ela que descrevia um template impossivel de aprovar.
  const validInput = { channelId: 'ch-1', name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá {{1}}, sua fatura venceu.', examples: ['Maria'] };

  test('rejects an invalid name without calling Meta', async () => {
    await expect(createTemplate({ ...validInput, name: 'Fatura Vencida' })).rejects.toThrow(TemplateValidationError);
    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
  });

  test('rejects a category outside MARKETING/UTILITY', async () => {
    await expect(createTemplate({ ...validInput, category: 'AUTHENTICATION' })).rejects.toThrow(TemplateValidationError);
  });

  // A conta errada e reprovada pela Meta na revisao, horas depois. Recusar aqui
  // devolve o erro na tela, antes de gastar um ciclo de aprovacao.
  test('rejects when the number of examples does not match the number of variables', async () => {
    await expect(createTemplate({ ...validInput, examples: [] })).rejects.toThrow(TemplateValidationError);
    await expect(createTemplate({ ...validInput, examples: ['Maria', 'sobrando'] })).rejects.toThrow(TemplateValidationError);
    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
  });

  test('accepts a body with no variables and no examples at all', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-10', status: 'PENDING' });
    createTemplateRecord.mockResolvedValue({ id: 'local-2' });

    await createTemplate({ ...validInput, bodyText: 'Aviso sem variavel.', examples: undefined });

    // Sem a chave `examples`: e o que mantem o payload identico ao de antes.
    expect(metaCloudAdapter.createMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Aviso sem variavel.' }
    );
  });

  test('rejects when the channel is not meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', config: {} });
    await expect(createTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('accepts a 360dialog channel the same way it accepts meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } });
    threeSixtyDialogAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-9', status: 'PENDING' });
    createTemplateRecord.mockResolvedValue({ id: 'local-1', wabaId: 'waba-1', metaTemplateId: 'meta-tpl-9', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', bodyText: validInput.bodyText, variableCount: 1, status: 'PENDING', rejectionReason: null, createdAt: new Date() });

    await createTemplate(validInput);

    expect(threeSixtyDialogAdapter.createMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } },
      expect.objectContaining({ name: 'fatura_vencida' })
    );
    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
  });

  test('rejects when the meta_cloud channel has no wabaId configured', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok' } });
    await expect(createTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('submits to Meta then persists locally with the returned metaTemplateId', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-9', status: 'PENDING' });
    createTemplateRecord.mockResolvedValue({ id: 'local-1', wabaId: 'waba-1', metaTemplateId: 'meta-tpl-9', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', bodyText: validInput.bodyText, variableCount: 1, status: 'PENDING', rejectionReason: null, createdAt: new Date() });

    const result = await createTemplate(validInput);

    expect(metaCloudAdapter.createMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: validInput.bodyText, examples: ['Maria'] }
    );
    expect(createTemplateRecord).toHaveBeenCalledWith({
      wabaId: 'waba-1', metaTemplateId: 'meta-tpl-9', name: 'fatura_vencida', language: 'pt_BR', category: 'UTILITY', bodyText: validInput.bodyText, variableCount: 1, buttons: [],
    });
    expect(result.id).toBe('local-1');
  });

  test('rolls back the Meta-side template when the local insert fails, then rethrows', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-9', status: 'PENDING' });
    const dbError = new Error('connection lost');
    createTemplateRecord.mockRejectedValue(dbError);

    await expect(createTemplate(validInput)).rejects.toThrow('connection lost');

    expect(metaCloudAdapter.deleteMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', metaTemplateId: 'meta-tpl-9' }
    );
  });

  test('still rethrows the original DB error even if the Meta rollback itself fails', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-9', status: 'PENDING' });
    const dbError = new Error('connection lost');
    createTemplateRecord.mockRejectedValue(dbError);
    metaCloudAdapter.deleteMetaTemplate.mockRejectedValue(new Error('meta also down'));

    await expect(createTemplate(validInput)).rejects.toThrow('connection lost');
  });

  test('rejects a bodyText with a variable gap as a TemplateValidationError, not a bare Error', async () => {
    await expect(createTemplate({ ...validInput, bodyText: 'Olá {{1}}, veja {{3}}.' })).rejects.toThrow(TemplateValidationError);
    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
  });
});

describe('listApprovedTemplatesForChannel', () => {
  test('returns approved templates for the channel\'s wabaId', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    listApprovedTemplatesByWabaId.mockResolvedValue([{ id: 'tpl-1' }]);

    const result = await listApprovedTemplatesForChannel('ch-1');

    expect(listApprovedTemplatesByWabaId).toHaveBeenCalledWith('waba-1', undefined);
    expect(result).toEqual([{ id: 'tpl-1' }]);
  });

  test('repassa a finalidade pedida para a consulta', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    listApprovedTemplatesByWabaId.mockResolvedValue([]);

    await listApprovedTemplatesForChannel('ch-1', 'disparo');

    expect(listApprovedTemplatesByWabaId).toHaveBeenCalledWith('waba-1', 'disparo');
  });

  test('returns an empty array when the channel has no wabaId', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: {} });
    expect(await listApprovedTemplatesForChannel('ch-1')).toEqual([]);
    expect(listApprovedTemplatesByWabaId).not.toHaveBeenCalled();
  });

  test('returns an empty array when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    expect(await listApprovedTemplatesForChannel('missing')).toEqual([]);
  });
});

describe('deleteTemplate', () => {
  test('deletes from Meta then locally when a channel for the WABA exists', async () => {
    findTemplateById.mockResolvedValue({ id: 'tpl-1', wabaId: 'waba-1', name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' });
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { accessToken: 'tok', wabaId: 'waba-1' } });
    deleteTemplateRecord.mockResolvedValue(true);

    const result = await deleteTemplate('tpl-1');

    expect(metaCloudAdapter.deleteMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: 'meta_cloud', config: { accessToken: 'tok', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' }
    );
    expect(deleteTemplateRecord).toHaveBeenCalledWith('tpl-1');
    expect(result).toBe(true);
  });

  test('returns false without calling Meta when the template does not exist locally', async () => {
    findTemplateById.mockResolvedValue(null);
    expect(await deleteTemplate('missing')).toBe(false);
    expect(metaCloudAdapter.deleteMetaTemplate).not.toHaveBeenCalled();
  });

  test('still deletes the local row when no channel remains for that WABA', async () => {
    findTemplateById.mockResolvedValue({ id: 'tpl-1', wabaId: 'waba-1', name: 'x', metaTemplateId: 'meta-1' });
    findChannelByWabaId.mockResolvedValue(null);
    deleteTemplateRecord.mockResolvedValue(true);

    const result = await deleteTemplate('tpl-1');

    expect(metaCloudAdapter.deleteMetaTemplate).not.toHaveBeenCalled();
    expect(deleteTemplateRecord).toHaveBeenCalledWith('tpl-1');
    expect(result).toBe(true);
  });

  test('still deletes the local row when the Meta delete call itself throws', async () => {
    findTemplateById.mockResolvedValue({ id: 'tpl-1', wabaId: 'waba-1', name: 'x', metaTemplateId: 'meta-1' });
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.deleteMetaTemplate.mockRejectedValue(new Error('Object does not exist'));
    deleteTemplateRecord.mockResolvedValue(true);

    const result = await deleteTemplate('tpl-1');

    expect(deleteTemplateRecord).toHaveBeenCalledWith('tpl-1');
    expect(result).toBe(true);
  });

  test('deletes via the 360dialog adapter when the owning channel is 360dialog', async () => {
    findTemplateById.mockResolvedValue({ id: 'local-1', wabaId: 'waba-1', name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' });
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } });
    deleteTemplateRecord.mockResolvedValue(true);

    await deleteTemplate('local-1');

    expect(threeSixtyDialogAdapter.deleteMetaTemplate).toHaveBeenCalledWith(
      { id: 'ch-1', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } },
      { name: 'fatura_vencida', metaTemplateId: 'meta-tpl-1' }
    );
    expect(metaCloudAdapter.deleteMetaTemplate).not.toHaveBeenCalled();
  });
});

describe('syncTemplatesForWaba', () => {
  test('updates local status for each template Meta returns', async () => {
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 'meta-1', status: 'APPROVED', rejected_reason: null },
      { id: 'meta-2', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' },
    ]);
    listTemplates.mockResolvedValue([{ id: 'tpl-1' }, { id: 'tpl-2' }]);

    const result = await syncTemplatesForWaba('waba-1');

    expect(updateTemplateStatusByMetaTemplateId).toHaveBeenCalledWith('meta-1', { status: 'APPROVED', rejectionReason: null });
    expect(updateTemplateStatusByMetaTemplateId).toHaveBeenCalledWith('meta-2', { status: 'REJECTED', rejectionReason: 'INVALID_FORMAT' });
    expect(result).toEqual([{ id: 'tpl-1' }, { id: 'tpl-2' }]);
  });

  test('skips an unrecognized status value without writing it', async () => {
    findChannelByWabaId.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { accessToken: 'tok', wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([{ id: 'meta-1', status: 'IN_APPEAL' }]);
    listTemplates.mockResolvedValue([]);

    await syncTemplatesForWaba('waba-1');

    expect(updateTemplateStatusByMetaTemplateId).not.toHaveBeenCalled();
  });

  test('throws when no channel exists for the given wabaId', async () => {
    findChannelByWabaId.mockResolvedValue(null);
    await expect(syncTemplatesForWaba('waba-1')).rejects.toThrow(TemplateValidationError);
  });
});

describe('applyTemplateStatusUpdates', () => {
  test('updates the matching local template', async () => {
    metaCloudAdapter.parseTemplateStatusUpdates.mockReturnValue([{ metaTemplateId: 'meta-1', event: 'APPROVED', reason: null }]);
    findTemplateByMetaTemplateId.mockResolvedValue({ id: 'tpl-1', metaTemplateId: 'meta-1' });

    await applyTemplateStatusUpdates({ entry: [] });

    expect(updateTemplateStatusByMetaTemplateId).toHaveBeenCalledWith('meta-1', { status: 'APPROVED', rejectionReason: null });
  });

  test('skips an update for a template id with no local match', async () => {
    metaCloudAdapter.parseTemplateStatusUpdates.mockReturnValue([{ metaTemplateId: 'unknown', event: 'APPROVED', reason: null }]);
    findTemplateByMetaTemplateId.mockResolvedValue(null);

    await applyTemplateStatusUpdates({ entry: [] });

    expect(updateTemplateStatusByMetaTemplateId).not.toHaveBeenCalled();
  });

  test('skips an unrecognized event value without writing it', async () => {
    metaCloudAdapter.parseTemplateStatusUpdates.mockReturnValue([{ metaTemplateId: 'meta-1', event: 'IN_APPEAL', reason: null }]);
    findTemplateByMetaTemplateId.mockResolvedValue({ id: 'tpl-1', metaTemplateId: 'meta-1' });

    await applyTemplateStatusUpdates({ entry: [] });

    expect(updateTemplateStatusByMetaTemplateId).not.toHaveBeenCalled();
  });
});

describe('registerExistingTemplate', () => {
  const validInput = { channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' };

  test('rejects an invalid name without calling Meta', async () => {
    await expect(registerExistingTemplate({ ...validInput, name: 'Aviso Cobranca' })).rejects.toThrow(TemplateValidationError);
    expect(metaCloudAdapter.listMetaTemplates).not.toHaveBeenCalled();
  });

  test('rejects an invalid headerType', async () => {
    await expect(registerExistingTemplate({ ...validInput, headerType: 'audio' })).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when language is missing', async () => {
    await expect(registerExistingTemplate({ channelId: 'ch-1', name: 'aviso_cobranca' })).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when the channel is not meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', config: {} });
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('accepts a 360dialog channel the same way it accepts meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { wabaId: 'waba-1' } });
    threeSixtyDialogAdapter.listMetaTemplates.mockResolvedValue([
      { id: 984, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Ola {{1}}' }] },
    ]);
    createTemplateRecord.mockResolvedValue({ id: 'local-1', metaTemplateId: '984', name: 'aviso_cobranca', status: 'PENDING' });
    updateTemplateStatusByMetaTemplateId.mockResolvedValue({ id: 'local-1', metaTemplateId: '984', status: 'APPROVED' });

    await registerExistingTemplate({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });

    expect(threeSixtyDialogAdapter.listMetaTemplates).toHaveBeenCalledWith({ id: 'ch-1', type: '360dialog', config: { wabaId: 'waba-1' } });
    expect(metaCloudAdapter.listMetaTemplates).not.toHaveBeenCalled();
  });

  test('rejects when the meta_cloud channel has no wabaId configured', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: {} });
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('rejects when no template matches the given name and language', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([{ id: 'meta-1', name: 'outro', language: 'pt_BR', category: 'UTILITY', components: [] }]);
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });

  test('finds the matching template by name+language and registers it locally without calling Meta to create anything', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 984, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Olá {{1}}, valor {{2}}' }] },
    ]);
    createTemplateRecord.mockResolvedValue({ id: 'local-1', metaTemplateId: '984', name: 'aviso_cobranca', status: 'PENDING' });
    updateTemplateStatusByMetaTemplateId.mockResolvedValue({ id: 'local-1', metaTemplateId: '984', name: 'aviso_cobranca', status: 'APPROVED' });

    const result = await registerExistingTemplate({ ...validInput, headerType: 'document' });

    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
    expect(createTemplateRecord).toHaveBeenCalledWith({
      wabaId: 'waba-1', metaTemplateId: '984', name: 'aviso_cobranca', language: 'pt_BR',
      category: 'UTILITY', bodyText: 'Olá {{1}}, valor {{2}}', variableCount: 2, headerType: 'document', buttons: [],
    });
    expect(updateTemplateStatusByMetaTemplateId).toHaveBeenCalledWith('984', { status: 'APPROVED', rejectionReason: null });
    expect(result.id).toBe('local-1');
    expect(result.status).toBe('APPROVED');
  });

  test('skips the status sync and returns the created row when Meta reports an unrecognized status', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 984, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', status: 'IN_APPEAL', components: [{ type: 'BODY', text: 'Olá {{1}}, valor {{2}}' }] },
    ]);
    createTemplateRecord.mockResolvedValue({ id: 'local-1', metaTemplateId: '984', name: 'aviso_cobranca', status: 'PENDING' });

    const result = await registerExistingTemplate(validInput);

    expect(updateTemplateStatusByMetaTemplateId).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'local-1', metaTemplateId: '984', name: 'aviso_cobranca', status: 'PENDING' });
  });

  test('rejects a matched template whose body has a variable gap', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 1, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}, veja {{3}}' }] },
    ]);
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
    expect(createTemplateRecord).not.toHaveBeenCalled();
  });

  test('rejects a matched template with no BODY component', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      { id: 1, name: 'aviso_cobranca', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'HEADER', format: 'DOCUMENT' }] },
    ]);
    await expect(registerExistingTemplate(validInput)).rejects.toThrow(TemplateValidationError);
  });
});

describe('createTemplate — botoes de resposta rapida', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    metaCloudAdapter.createMetaTemplate.mockResolvedValue({ metaTemplateId: 'meta-tpl-1', status: 'PENDING' });
    createTemplateRecord.mockResolvedValue({ id: 'tpl-1' });
  });

  test('leva os botoes para a Meta e para o registro local', async () => {
    await createTemplate({
      channelId: 'channel-1', name: 'agendar_instalacao', category: 'UTILITY', language: 'pt_BR',
      bodyText: 'Podemos agendar?', buttons: ['Sim', 'Outro dia'],
    });

    expect(metaCloudAdapter.createMetaTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ buttons: ['Sim', 'Outro dia'] })
    );
    expect(createTemplateRecord).toHaveBeenCalledWith(expect.objectContaining({ buttons: ['Sim', 'Outro dia'] }));
  });

  // Recusar antes de chamar a Meta: template rejeitado por ela nao volta atras,
  // e o nome fica ocupado.
  test('recusa botoes invalidos sem chamar a Meta', async () => {
    await expect(
      createTemplate({
        channelId: 'channel-1', name: 'agendar', category: 'UTILITY', language: 'pt_BR',
        bodyText: 'Podemos agendar?', buttons: ['a', 'b', 'c', 'd'],
      })
    ).rejects.toThrow(TemplateValidationError);

    expect(metaCloudAdapter.createMetaTemplate).not.toHaveBeenCalled();
  });
});

// Template com botoes criado direto no painel da Meta e registrado por aqui
// tem que chegar com os botoes: senao a previa mente sobre o que o cliente ve.
describe('registerExistingTemplate — botoes', () => {
  test('adota os botoes de resposta rapida que ja existem na Meta', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1', accessToken: 'tok' } });
    metaCloudAdapter.listMetaTemplates.mockResolvedValue([
      {
        id: 'meta-tpl-5', name: 'agendar', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED',
        components: [
          { type: 'BODY', text: 'Podemos agendar?' },
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }, { type: 'URL', text: 'Site', url: 'https://x' }] },
        ],
      },
    ]);
    createTemplateRecord.mockResolvedValue({ id: 'local-5', metaTemplateId: 'meta-tpl-5' });
    updateTemplateStatusByMetaTemplateId.mockResolvedValue({ id: 'local-5' });

    await registerExistingTemplate({ channelId: 'ch-1', name: 'agendar', language: 'pt_BR' });

    // Só QUICK_REPLY: botao de URL nao e resposta e nao abre a janela de 24 h.
    expect(createTemplateRecord).toHaveBeenCalledWith(expect.objectContaining({ buttons: ['Sim'] }));
  });
});
