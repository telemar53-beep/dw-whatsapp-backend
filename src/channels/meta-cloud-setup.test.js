jest.mock('../whatsapp-adapters/meta-cloud.adapter');
const { listWabaPhoneNumbers, listWabaSubscribedApps } = require('../whatsapp-adapters/meta-cloud.adapter');
const { checkMetaCloudSetup } = require('./meta-cloud-setup');

const DADOS = {
  phoneNumberId: '613336748527998',
  accessToken: 'tok-meta',
  wabaId: '3530350190603464',
  phoneNumber: '+558004454546',
};

function wabaCom(numeros) {
  listWabaPhoneNumbers.mockResolvedValue(numeros);
}

function appsInscritos(quantos) {
  listWabaSubscribedApps.mockResolvedValue(
    Array.from({ length: quantos }, () => ({ whatsapp_business_api_data: { id: '1090048386724471' } }))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkMetaCloudSetup', () => {
  test('aprova quando o numero pertence a WABA, o telefone bate e ha app inscrito', async () => {
    wabaCom([{ id: '613336748527998', display_phone_number: '+55 800 445 4546' }]);
    appsInscritos(1);

    expect(await checkMetaCloudSetup(DADOS)).toEqual({ ok: true });
  });

  test('ignora espacos e tracos ao comparar o telefone', async () => {
    wabaCom([{ id: '613336748527998', display_phone_number: '+55 800 445-4546' }]);
    appsInscritos(1);

    expect((await checkMetaCloudSetup(DADOS)).ok).toBe(true);
  });

  test('recusa quando nenhum app esta inscrito no webhook da WABA', async () => {
    wabaCom([{ id: '613336748527998', display_phone_number: '+55 800 445 4546' }]);
    appsInscritos(0);

    const resultado = await checkMetaCloudSetup(DADOS);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/inscrito/i);
  });

  test('recusa quando o Phone Number ID nao pertence aquela WABA', async () => {
    wabaCom([{ id: '999999999999999', display_phone_number: '+55 98 8445-4546' }]);

    const resultado = await checkMetaCloudSetup(DADOS);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/WABA/);
    expect(listWabaSubscribedApps).not.toHaveBeenCalled();
  });

  test('recusa quando o telefone digitado e de outro numero, e diz qual e o certo', async () => {
    wabaCom([{ id: '613336748527998', display_phone_number: '+55 98 8445-4546' }]);

    const resultado = await checkMetaCloudSetup(DADOS);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('+55 98 8445-4546');
  });

  test('repassa o motivo da Meta quando o token nao vale', async () => {
    listWabaPhoneNumbers.mockRejectedValue({
      response: { data: { error: { code: 190, message: 'Session has expired' } } },
    });

    const resultado = await checkMetaCloudSetup(DADOS);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/^\(190\)/);
  });

  test('recusa com recado proprio quando nem deu para falar com a Meta', async () => {
    listWabaPhoneNumbers.mockRejectedValue(new Error('timeout of 5000ms exceeded'));

    const resultado = await checkMetaCloudSetup(DADOS);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/Meta/);
  });

  test('repassa o motivo da Meta quando a consulta de apps inscritos falha', async () => {
    wabaCom([{ id: '613336748527998', display_phone_number: '+55 800 445 4546' }]);
    listWabaSubscribedApps.mockRejectedValue({
      response: { data: { error: { code: 200, message: 'Permissions error' } } },
    });

    const resultado = await checkMetaCloudSetup(DADOS);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/^\(200\)/);
  });
});
