jest.mock('./city.repository');
jest.mock('../conversations/contact.repository');

const { listCities, findPlaceBySgpPop } = require('./city.repository');
const { setContactCityIfEmpty, setContactLocalityIfEmpty } = require('../conversations/contact.repository');
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
    expect(resultado).toEqual({ preenchida: true, cityId: CANDIDO.id, localidade: { preenchida: false } });
    expect(contact.cityId).toBe(CANDIDO.id);
  });

  test('não mexe no contato que já tem cidade', async () => {
    const contact = { id: 'contact-1', cityId: GODOFREDO.id };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('CANDIDO MENDES')]);

    expect(resultado).toEqual({ preenchida: false, localidade: { preenchida: false } });
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

    expect(resultado).toEqual({ preenchida: true, cityId: CANDIDO.id, localidade: { preenchida: false } });
    expect(setContactCityIfEmpty).toHaveBeenCalledTimes(1);
  });

  test('não preenche quando os contratos estão em cidades diferentes', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [
      contrato('CANDIDO MENDES'),
      contrato('GODOFREDO VIANA'),
    ]);

    expect(resultado).toEqual({ preenchida: false, motivo: 'contratos em cidades diferentes', localidade: { preenchida: false } });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
    expect(contact.cityId).toBeNull();
  });

  test('não preenche quando nenhum contrato traz cidade', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato(null), contrato('')]);

    expect(resultado).toEqual({ preenchida: false, localidade: { preenchida: false } });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
  });

  test('não preenche quando a cidade do SGP não está cadastrada no chat', async () => {
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('SAO LUIS')]);

    expect(resultado).toEqual({ preenchida: false, localidade: { preenchida: false } });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
    expect(contact.cityId).toBeNull();
  });

  test('não preenche sem contratos', async () => {
    const contact = { id: 'contact-1', cityId: null };
    expect(await preencherCidadePeloSgp(contact, [])).toEqual({ preenchida: false, localidade: { preenchida: false } });
    expect(await preencherCidadePeloSgp(contact, null)).toEqual({ preenchida: false, localidade: { preenchida: false } });
    expect(setContactCityIfEmpty).not.toHaveBeenCalled();
  });

  test('quando o UPDATE não pega (alguém preencheu antes), não mente que preencheu', async () => {
    setContactCityIfEmpty.mockResolvedValue(null);
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('CANDIDO MENDES')]);

    expect(resultado).toEqual({ preenchida: false, localidade: { preenchida: false } });
    expect(contact.cityId).toBeNull();
  });

  test('uma falha do banco não derruba a identificação', async () => {
    const erro = new Error('connection terminated');
    setContactCityIfEmpty.mockRejectedValue(erro);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const contact = { id: 'contact-1', cityId: null };

    const resultado = await preencherCidadePeloSgp(contact, [contrato('CANDIDO MENDES')]);

    expect(resultado).toEqual({ preenchida: false, localidade: { preenchida: false } });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('connection terminated'));
    spy.mockRestore();
  });
});

// POP real confirmado em producao (2026-09-22), em tres clientes de Barao de
// Tromai: popName "Barão de tromai/MA" e city "CÂNDIDO MENDES". Serve de
// EVIDENCIA para o teste; o casamento e por chave normalizada do cadastro, e
// nenhum desses valores existe no codigo.
const BARAO = {
  id: 'loc-1', name: 'Barão de Tromaí', kind: 'locality',
  parentId: CANDIDO.id, active: true, served: true,
};

function contratoComPop(city, popName) {
  return { id: 17402, status: 'Ativo', city, popName };
}

describe('preenchimento da localidade pelo POP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listCities.mockResolvedValue([CANDIDO, GODOFREDO]);
    setContactCityIfEmpty.mockResolvedValue({ id: 'contact-1', cityId: CANDIDO.id });
    setContactLocalityIfEmpty.mockResolvedValue({ id: 'contact-1', localityId: BARAO.id });
    findPlaceBySgpPop.mockResolvedValue(null);
  });

  test('POP correspondente preenche a localidade', async () => {
    findPlaceBySgpPop.mockResolvedValue(BARAO);
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA')]);

    expect(findPlaceBySgpPop).toHaveBeenCalledWith('Barão de tromai/MA');
    expect(setContactLocalityIfEmpty).toHaveBeenCalledWith('contact-1', BARAO.id);
    expect(contact.localityId).toBe(BARAO.id);
    expect(r.localidade).toEqual({ preenchida: true, localityId: BARAO.id });
  });

  test('a normalizacao casa caixa, acento e espacos sobrando', async () => {
    findPlaceBySgpPop.mockResolvedValue(BARAO);
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', '  BARAO   DE TROMAI/ma  ')]);

    // O servico entrega o valor cru; quem normaliza dos dois lados e a consulta,
    // com a MESMA funcao do matcher.
    expect(findPlaceBySgpPop).toHaveBeenCalledWith('  BARAO   DE TROMAI/ma  ');
    expect(setContactLocalityIfEmpty).toHaveBeenCalled();
  });

  test('municipio incompativel NAO preenche', async () => {
    findPlaceBySgpPop.mockResolvedValue({ ...BARAO, parentId: GODOFREDO.id });
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA')]);

    expect(setContactLocalityIfEmpty).not.toHaveBeenCalled();
    expect(contact.localityId).toBeNull();
    expect(r.localidade.motivo).toBe('localidade de outro município');
  });

  test('localidade ja escolhida NAO e sobrescrita', async () => {
    findPlaceBySgpPop.mockResolvedValue(BARAO);
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: 'escolhida-a-mao' };

    await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA')]);

    expect(findPlaceBySgpPop).not.toHaveBeenCalled();
    expect(setContactLocalityIfEmpty).not.toHaveBeenCalled();
    expect(contact.localityId).toBe('escolhida-a-mao');
  });

  test('POP ausente nao quebra e nao preenche', async () => {
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', null)]);

    expect(findPlaceBySgpPop).not.toHaveBeenCalled();
    expect(r.localidade.preenchida).toBe(false);
  });

  test('POP desconhecido no cadastro nao preenche e nao quebra', async () => {
    findPlaceBySgpPop.mockResolvedValue(null);
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'POP que ninguem cadastrou')]);

    expect(setContactLocalityIfEmpty).not.toHaveBeenCalled();
    expect(r.localidade.preenchida).toBe(false);
  });

  test('POP cadastrado num MUNICIPIO (nao localidade) nao preenche', async () => {
    findPlaceBySgpPop.mockResolvedValue({ ...CANDIDO, kind: 'city', parentId: null, active: true });
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA')]);

    expect(setContactLocalityIfEmpty).not.toHaveBeenCalled();
    expect(r.localidade.preenchida).toBe(false);
  });

  test('localidade inativa nao preenche', async () => {
    findPlaceBySgpPop.mockResolvedValue({ ...BARAO, active: false });
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA')]);

    expect(setContactLocalityIfEmpty).not.toHaveBeenCalled();
    expect(r.localidade.preenchida).toBe(false);
  });

  test('contratos com POPs DIFERENTES nao escolhem o primeiro', async () => {
    findPlaceBySgpPop.mockResolvedValue(BARAO);
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [
      contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA'),
      contratoComPop('CÂNDIDO MENDES', 'Outro POP/MA'),
    ]);

    expect(findPlaceBySgpPop).not.toHaveBeenCalled();
    expect(setContactLocalityIfEmpty).not.toHaveBeenCalled();
    expect(r.localidade.motivo).toBe('contratos em POPs diferentes');
  });

  test('o mesmo POP em varios contratos, escrito diferente, nao e ambiguidade', async () => {
    findPlaceBySgpPop.mockResolvedValue(BARAO);
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    await preencherCidadePeloSgp(contact, [
      contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA'),
      contratoComPop('CÂNDIDO MENDES', 'BARAO DE TROMAI/MA'),
    ]);

    expect(setContactLocalityIfEmpty).toHaveBeenCalledWith('contact-1', BARAO.id);
  });

  test('sem municipio identificado nao ha com que conferir o pai', async () => {
    findPlaceBySgpPop.mockResolvedValue(BARAO);
    setContactCityIfEmpty.mockResolvedValue(null);
    const contact = { id: 'contact-1', cityId: null, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('Cidade que nao existe no cadastro', 'Barão de tromai/MA')]);

    expect(setContactLocalityIfEmpty).not.toHaveBeenCalled();
    expect(r.localidade.preenchida).toBe(false);
  });

  test('o municipio recem-preenchido no mesmo turno ja vale para conferir o pai', async () => {
    findPlaceBySgpPop.mockResolvedValue(BARAO);
    const contact = { id: 'contact-1', cityId: null, localityId: null };

    await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA')]);

    expect(contact.cityId).toBe(CANDIDO.id);
    expect(setContactLocalityIfEmpty).toHaveBeenCalledWith('contact-1', BARAO.id);
  });

  test('uma falha na consulta do POP nao derruba a identificacao', async () => {
    findPlaceBySgpPop.mockRejectedValue(new Error('db down'));
    const contact = { id: 'contact-1', cityId: CANDIDO.id, localityId: null };

    const r = await preencherCidadePeloSgp(contact, [contratoComPop('CÂNDIDO MENDES', 'Barão de tromai/MA')]);

    expect(r.localidade.preenchida).toBe(false);
    expect(contact.localityId).toBeNull();
  });
});
