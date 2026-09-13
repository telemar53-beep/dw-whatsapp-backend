jest.mock('./ai-config.repository');
jest.mock('../reasons/reason.repository');

const { getAiConfig } = require('./ai-config.repository');
const { findReasonById } = require('../reasons/reason.repository');
const { motivoDeEncerramentoAtivo } = require('./triage-close-reason');

const MOTIVO_ID = '44444444-4444-4444-4444-444444444444';

describe('motivoDeEncerramentoAtivo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAiConfig.mockResolvedValue({ triageResolvedReasonId: MOTIVO_ID });
    findReasonById.mockResolvedValue({ id: MOTIVO_ID, name: 'Resolvido pela IA', active: true });
  });

  test('devolve o id quando o motivo configurado existe e está ativo', async () => {
    expect(await motivoDeEncerramentoAtivo()).toBe(MOTIVO_ID);
    expect(findReasonById).toHaveBeenCalledWith(MOTIVO_ID);
  });

  test('sem motivo configurado, devolve null sem consultar os motivos', async () => {
    getAiConfig.mockResolvedValue({ triageResolvedReasonId: null });
    expect(await motivoDeEncerramentoAtivo()).toBeNull();
    expect(findReasonById).not.toHaveBeenCalled();
  });

  // A coluna não tem chave estrangeira: um id órfão é possível e não pode
  // virar um INSERT quebrado lá no evento de fechamento.
  test('motivo inexistente devolve null', async () => {
    findReasonById.mockResolvedValue(null);
    expect(await motivoDeEncerramentoAtivo()).toBeNull();
  });

  // O caso que acontece de verdade: o admin desativa o motivo e esquece de
  // trocar a configuração. Desativado = encerramento pela IA desligado.
  test('motivo desativado devolve null', async () => {
    findReasonById.mockResolvedValue({ id: MOTIVO_ID, name: 'Antigo', active: false });
    expect(await motivoDeEncerramentoAtivo()).toBeNull();
  });

  test('sem configuração nenhuma no banco, devolve null', async () => {
    getAiConfig.mockResolvedValue(null);
    expect(await motivoDeEncerramentoAtivo()).toBeNull();
    expect(findReasonById).not.toHaveBeenCalled();
  });
});
