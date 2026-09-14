jest.mock('./city.repository');
jest.mock('../conversations/contact.repository');

const { listCities } = require('./city.repository');
const { setContactCityIfEmpty } = require('../conversations/contact.repository');
const { preencherCidadePeloSgp } = require('./contact-city.service');

const CANDIDO = { id: 'city-1', name: 'Cândido Mendes' };
const GODOFREDO = { id: 'city-2', name: 'Godofredo Viana' };

function contrato(city) {
  return { id: 17402, status: 'Ativo', city };
}

describe('preencherCidadePeloSgp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listCities.mockResolvedValue([CANDIDO, GODOFREDO]);
    setContactCityIfEmpty.mockResolvedValue({ id: 'contact-1', cityId: CANDIDO.id });
  });

  test('preenche a cidade do contato a partir do contrato e muta o contato em memória', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('CANDIDO MENDES')]);

    expect(setContactCityIfEmpty).toHaveBeenCalledWith('contact-1', CANDIDO.id);
    expect(resultado).toEqual({ preenchida: true, cityId: CANDIDO.id });
    expect(contact.cityId).toBe(CANDIDO.id);
  });

  test('não mexe no contato que já tem cidade', async () => {
    const contact = { id: 'contact-1', cityId: GODOFREDO.id };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('CANDIDO MENDES')]);

    expect(resultado).toEqual({ preenchida: false });
    expect(listCities).not.toHaveBeenCalled();
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
    expect(contact.cityId).toBe(GODOFREDO.id);
  });

  test('aceita vários contratos na mesma cidade, escrita de jeitos diferentes', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [
      contrato('CANDIDO MENDES'),
      contrato('Cândido  Mendes'),
    ]);

    expect(resultado).toEqual({ preenchida: true, cityId: CANDIDO.id });
    expect(setContactCityIfEmpty).toHaveBeenCalledTimes(1);
  });

  test('não preenche quando os contratos estão em cidades diferentes', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [
      contrato('CANDIDO MENDES'),
      contrato('GODOFREDO VIANA'),
    ]);

    expect(resultado).toEqual({ preenchida: false, motivo: 'contratos em cidades diferentes' });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
    expect(contact.cityId).toBeNull();
  });

  test('não preenche quando nenhum contrato traz cidade', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato(null), contrato('')]);

    expect(resultado).toEqual({ preenchida: false });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
  });

  test('não preenche quando a cidade do SGP não está cadastrada no chat', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('SAO LUIS')]);

    expect(resultado).toEqual({ preenchida: false });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
    expect(contact.cityId).toBeNull();
  });

  test('não preenche sem contratos', async () => {
    const contact = { id: 'contact-1', cityId: null };
    expect(await preencherCidadePeloSgp(contact, [])).toEqual({ preenchida: false });
    expect(await preencherCidadePeloSgp(contact, null)).toEqual({ preenchida: false });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
  });

  test('quando o UPDATE não pega (alguém preencheu antes), não mente que preencheu', async () => {
    setContactCityIfEmpty.mockResolvedValue(null);
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('CANDIDO MENDES')]);

    expect(resultado).toEqual({ preenchida: false });
    expect(contact.cityId).toBeNull();
  });

  test('uma falha do banco não derruba a identificação', async () => {
    const erro = new Error('connection terminated');
    setContactCityIfEmpty.mockRejectedValue(erro);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('CANDIDO MENDES')]);

    expect(resultado).toEqual({ preenchida: false });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('connection terminated'));
    spy.mockRestore();
  });
});
