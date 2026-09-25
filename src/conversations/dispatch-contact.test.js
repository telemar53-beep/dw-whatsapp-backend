jest.mock('./contact.repository');
const { findContactsWithOwnHistoryByPhoneNumbers, findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { escolherContatoDoDisparo, resolverContatoDoDisparo } = require('./dispatch-contact');

const COM9 = '5598985120338';
const SEM9 = '559885120338';
const contato = (id, phoneNumber) => ({ id, phoneNumber });

beforeEach(() => jest.clearAllMocks());

describe('escolherContatoDoDisparo (regra pura)', () => {
  // Revisão da Fase 1A (25/09/2026): a escolha entre as duas formas usa EVIDÊNCIA FORTE de
  // identidade (entrada real, vínculo SGP, nota interna). Conversa não-silent sem entrada é
  // histórico (temHistoricoProprio), mas não decide a escolha. Nos 6 pares ambíguos de
  // produção, o lado com 9 só tinha conversas de atendente com saída, sem nenhuma entrada.
  const forma = (id, phoneNumber, temEvidenciaForte, temHistoricoProprio = temEvidenciaForte) => ({
    contact: contato(id, phoneNumber), temEvidenciaForte, temHistoricoProprio,
  });

  test('nenhuma forma existe: usa o número que o SGP mandou (cria)', () => {
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes: [] }))
      .toEqual({ acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_existe' });
  });

  test('SGP manda com 9 e só existe o contato sem 9 (com entrada): reutiliza o sem 9', () => {
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes: [forma('real', SEM9, true)] }))
      .toEqual({ acao: 'reusar', contatoId: 'real', motivo: 'unica_forma_existente' });
  });

  test('só existe o contato com 9 (válido): mantém', () => {
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes: [forma('c9', COM9, true)] }))
      .toEqual({ acao: 'reusar', contatoId: 'c9', motivo: 'unica_forma_existente' });
  });

  test('fantasma com 9 + contato real sem 9: reutiliza o real', () => {
    const existentes = [forma('fantasma', COM9, false), forma('real', SEM9, true)];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'reusar', contatoId: 'real', motivo: 'so_uma_forma_com_evidencia_forte' });
  });

  test('CASO real (par do teste de 25/09): com 9 só com conversa de atendente (histórico, sem evidência forte) + sem 9 com entrada: escolhe o sem 9', () => {
    const existentes = [forma('c9', COM9, false, true), forma('real', SEM9, true, true)];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'reusar', contatoId: 'real', motivo: 'so_uma_forma_com_evidencia_forte' });
  });

  test('espelho: com 9 com entrada + sem 9 só com saída: escolhe o com 9, mesmo que o SGP mande sem 9', () => {
    const existentes = [forma('c9', COM9, true, true), forma('s9', SEM9, false, true)];
    expect(escolherContatoDoDisparo({ digitado: SEM9, existentes }))
      .toEqual({ acao: 'reusar', contatoId: 'c9', motivo: 'so_uma_forma_com_evidencia_forte' });
  });

  test('as duas formas com evidência forte: não une, não escolhe; fica o número do SGP e marca ambiguidade', () => {
    const existentes = [forma('a', COM9, true), forma('b', SEM9, true)];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'digitado', ambiguo: true, motivo: 'duas_formas_com_evidencia_forte' });
  });

  test('nenhuma com evidência forte, as duas só com saída: conservador — número do SGP, sem inventar identidade', () => {
    const existentes = [forma('a', COM9, false, true), forma('b', SEM9, false, true)];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_com_evidencia_forte' });
  });

  test('nenhuma com evidência forte e só uma com conversa de saída: NÃO escolhe por ela (conservador)', () => {
    const existentes = [forma('a', COM9, false, false), forma('b', SEM9, false, true)];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_com_evidencia_forte' });
  });

  test('as duas formas sem histórico (dois fantasmas): comportamento de hoje, sem ambiguidade', () => {
    const existentes = [forma('f1', COM9, false), forma('f2', SEM9, false)];
    expect(escolherContatoDoDisparo({ digitado: COM9, existentes }))
      .toEqual({ acao: 'digitado', ambiguo: false, motivo: 'nenhuma_forma_com_evidencia_forte' });
  });
});

describe('resolverContatoDoDisparo', () => {
  test('reutiliza o contato real sem 9 e não cria nada', async () => {
    const real = contato('real', SEM9);
    findContactsWithOwnHistoryByPhoneNumbers.mockResolvedValue([
      { contact: contato('fantasma', COM9), temHistoricoProprio: false, temEvidenciaForte: false },
      { contact: real, temHistoricoProprio: true, temEvidenciaForte: true },
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
      { contact: contato('a', COM9), temHistoricoProprio: true, temEvidenciaForte: true },
      { contact: contato('b', SEM9), temHistoricoProprio: true, temEvidenciaForte: true },
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
