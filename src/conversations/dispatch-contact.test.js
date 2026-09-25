jest.mock('./contact.repository');
const { findContactsWithOwnHistoryByPhoneNumbers, findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { escolherContatoDoDisparo, resolverContatoDoDisparo } = require('./dispatch-contact');

const COM9 = '5598985120338';
const SEM9 = '559885120338';
const contato = (id, phoneNumber) => ({ id, phoneNumber });

beforeEach(() => jest.clearAllMocks());

describe('escolherContatoDoDisparo (regra pura)', () => {
  test('nenhuma forma existe: usa o número que o SGP mandou (cria)', () => {
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes: [] }))
      .toEqual({ acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_existe' });
  });

  test('SGP manda com 9 e só existe o contato sem 9 (com entrada): reutiliza o sem 9', () => {
    const real = contato('real', SEM9);
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes: [{ contact: real, temHistoricoProprio: true }] }))
      .toEqual({ acao: 'reusar', contatoId: 'real', motivo: 'unica_forma_existente' });
  });

  test('só existe o contato com 9 (válido): mantém', () => {
    const c9 = contato('c9', COM9);
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes: [{ contact: c9, temHistoricoProprio: true }] }))
      .toEqual({ acao: 'reusar', contatoId: 'c9', motivo: 'unica_forma_existente' });
  });

  test('fantasma com 9 + contato real sem 9: reutiliza o real', () => {
    const existentes = [
      { contact: contato('fantasma', COM9), temHistoricoProprio: false },
      { contact: contato('real', SEM9), temHistoricoProprio: true },
    ];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'reusar', contatoId: 'real', motivo: 'so_uma_forma_com_historico' });
  });

  test('as duas formas com histórico próprio: não une, não escolhe; fica o comportamento de hoje e marca ambiguidade', () => {
    const existentes = [
      { contact: contato('a', COM9), temHistoricoProprio: true },
      { contact: contato('b', SEM9), temHistoricoProprio: true },
    ];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'digitado', ambiguo: true, motivo: 'duas_formas_com_historico' });
  });

  test('as duas formas sem histórico (dois fantasmas): comportamento de hoje, sem ambiguidade', () => {
    const existentes = [
      { contact: contato('f1', COM9), temHistoricoProprio: false },
      { contact: contato('f2', SEM9), temHistoricoProprio: false },
    ];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'digitado', ambiguo: false, motivo: 'duas_formas_sem_historico' });
  });
});

describe('resolverContatoDoDisparo', () => {
  test('reutiliza o contato real sem 9 e não cria nada', async () => {
    const real = contato('real', SEM9);
    findContactsWithOwnHistoryByPhoneNumbers.mockResolvedValue([
      { contact: contato('fantasma', COM9), temHistoricoProprio: false },
      { contact: real, temHistoricoProprio: true },
    ]);
    const r = await resolverContatoDoDisparo(COM9);
    expect(findContactsWithOwnHistoryByPhoneNumbers).toHaveBeenCalledWith([COM9, SEM9]);
    expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
    expect(r).toEqual(real);
  });

  test('nenhuma forma existe: cria com o número do SGP, como hoje', async () => {
    findContactsWithOwnHistoryByPhoneNumbers.mockResolvedValue([]);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'novo', phoneNumber: COM9, wasCreated: true });
    const r = await resolverContatoDoDisparo(COM9, 'Maria');
    expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith(COM9, 'Maria');
    expect(r).toEqual({ id: 'novo', phoneNumber: COM9 });
  });

  test('ambiguidade: usa o número do SGP (como hoje) e registra o fato sem o número inteiro', async () => {
    findContactsWithOwnHistoryByPhoneNumbers.mockResolvedValue([
      { contact: contato('a', COM9), temHistoricoProprio: true },
      { contact: contato('b', SEM9), temHistoricoProprio: true },
    ]);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'a', phoneNumber: COM9, wasCreated: false });
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await resolverContatoDoDisparo(COM9);
    expect(r).toEqual({ id: 'a', phoneNumber: COM9 });
    expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith(COM9, null);
    const log = spy.mock.calls.flat().join(' ');
    expect(log).toContain('ambiguous');
    expect(log).not.toContain(COM9);
    expect(log).not.toContain(SEM9);
    spy.mockRestore();
  });

  test('número fixo nunca ganha variante: nem consulta as formas', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'fixo', phoneNumber: '559832345678', wasCreated: false });
    const r = await resolverContatoDoDisparo('559832345678');
    expect(findContactsWithOwnHistoryByPhoneNumbers).not.toHaveBeenCalled();
    expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith('559832345678', null);
    expect(r).toEqual({ id: 'fixo', phoneNumber: '559832345678' });
  });
});
