jest.mock('./sector.repository');
const { listSectors } = require('./sector.repository');
const { ehSetorDeReativacao, setorDeReativacao } = require('./reactivation-sector');

// Regra financeira 0/1/2+ (25/09/2026): o destino é o setor de reativação que JÁ existe no painel.
// Os setores são dados; o código só reconhece qual é o de reativação pelo nome.
describe('setor de reativação', () => {
  test.each(['Reativação', 'REATIVAÇÃO', 'reativacao', 'Reativação de clientes'])('"%s" é o setor de reativação', (name) => {
    expect(ehSetorDeReativacao({ id: 's', name })).toBe(true);
  });

  test.each(['Financeiro', 'Suporte', 'Comercial', '', null])('"%s" não é', (name) => {
    expect(ehSetorDeReativacao({ id: 's', name })).toBe(false);
  });

  test('devolve o setor cadastrado, ou null quando não existe', async () => {
    listSectors.mockResolvedValueOnce([{ id: 'a', name: 'Financeiro' }, { id: 'b', name: 'Reativação' }]);
    expect(await setorDeReativacao()).toEqual({ id: 'b', name: 'Reativação' });
    listSectors.mockResolvedValueOnce([{ id: 'a', name: 'Financeiro' }]);
    expect(await setorDeReativacao()).toBeNull();
  });
});
