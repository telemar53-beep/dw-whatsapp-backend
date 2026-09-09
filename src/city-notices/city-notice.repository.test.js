const { getPool, closePool } = require('../db/pool');
const { createCity } = require('../cities/city.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const {
  listCityNoticesByCityIds,
  findActiveCityNoticeByCityId,
  upsertCityNotice,
  deleteCityNotice,
  hasContactReceivedNotice,
  recordNoticeDelivery,
} = require('./city-notice.repository');

describe('city notice repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE city_notice_deliveries, city_notices, cities, contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('findActiveCityNoticeByCityId returns null when the city has no notice', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    expect(await findActiveCityNoticeByCityId(city.id)).toBeNull();
  });

  test('findActiveCityNoticeByCityId returns null for a null or undefined cityId, without querying', async () => {
    expect(await findActiveCityNoticeByCityId(null)).toBeNull();
    expect(await findActiveCityNoticeByCityId(undefined)).toBeNull();
  });

  test('findActiveCityNoticeByCityId returns null when the notice exists but is disabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    await upsertCityNotice(city.id, { message: 'Instabilidade na rede', enabled: false });
    expect(await findActiveCityNoticeByCityId(city.id)).toBeNull();
  });

  test('findActiveCityNoticeByCityId returns the notice when enabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    await upsertCityNotice(city.id, { message: 'Instabilidade na rede', enabled: true });

    const notice = await findActiveCityNoticeByCityId(city.id);

    expect(notice.cityId).toBe(city.id);
    expect(notice.message).toBe('Instabilidade na rede');
    expect(notice.enabled).toBe(true);
  });

  test('upsertCityNotice sets activatedAt when created already enabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    expect(notice.activatedAt).not.toBeNull();
  });

  test('upsertCityNotice leaves activatedAt null when created disabled', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: false });
    expect(notice.activatedAt).toBeNull();
  });

  test('upsertCityNotice updates the same row on a second call for the same city, instead of creating a second one', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const first = await upsertCityNotice(city.id, { message: 'Primeiro texto', enabled: false });

    const second = await upsertCityNotice(city.id, { message: 'Segundo texto', enabled: false });

    expect(second.id).toBe(first.id);
    expect(second.message).toBe('Segundo texto');
  });

  test('upsertCityNotice resets deliveries when enabled transitions from false to true (reactivation)', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990001', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    await recordNoticeDelivery(notice.id, contact.id);
    expect(await hasContactReceivedNotice(notice.id, contact.id)).toBe(true);

    await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: false });
    const reactivated = await upsertCityNotice(city.id, { message: 'Instabilidade de novo', enabled: true });

    expect(await hasContactReceivedNotice(reactivated.id, contact.id)).toBe(false);
  });

  test('upsertCityNotice does not reset deliveries when enabled stays true across an edit', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990002', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    await recordNoticeDelivery(notice.id, contact.id);

    await upsertCityNotice(city.id, { message: 'Texto editado', enabled: true });

    expect(await hasContactReceivedNotice(notice.id, contact.id)).toBe(true);
  });

  test('deleteCityNotice removes the notice and returns true', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });

    const deleted = await deleteCityNotice(city.id);

    expect(deleted).toBe(true);
    expect(await findActiveCityNoticeByCityId(city.id)).toBeNull();
  });

  test('deleteCityNotice returns false when the city has no notice', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    expect(await deleteCityNotice(city.id)).toBe(false);
  });

  test('deleteCityNotice cascades to remove delivery records', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990003', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });
    await recordNoticeDelivery(notice.id, contact.id);

    await deleteCityNotice(city.id);

    const result = await getPool().query('SELECT * FROM city_notice_deliveries WHERE city_notice_id = $1', [notice.id]);
    expect(result.rowCount).toBe(0);
  });

  test('listCityNoticesByCityIds returns notices for the given cities, empty array for an empty input', async () => {
    const cityA = await createCity({ name: 'Cidade A' });
    const cityB = await createCity({ name: 'Cidade B' });
    await upsertCityNotice(cityA.id, { message: 'Aviso A', enabled: true });

    expect(await listCityNoticesByCityIds([])).toEqual([]);
    const notices = await listCityNoticesByCityIds([cityA.id, cityB.id]);
    expect(notices).toHaveLength(1);
    expect(notices[0].cityId).toBe(cityA.id);
  });

  test('hasContactReceivedNotice returns false before any delivery is recorded', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990004', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });

    expect(await hasContactReceivedNotice(notice.id, contact.id)).toBe(false);
  });

  test('recordNoticeDelivery returns true on the first claim and false on a repeat claim', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990006', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });

    expect(await recordNoticeDelivery(notice.id, contact.id)).toBe(true);
    expect(await recordNoticeDelivery(notice.id, contact.id)).toBe(false);
  });

  test('recordNoticeDelivery is idempotent — calling it twice does not throw or duplicate', async () => {
    const city = await createCity({ name: 'Maracaçumé' });
    const contact = await findOrCreateContactByPhoneNumber('+5598999990005', 'Cliente');
    const notice = await upsertCityNotice(city.id, { message: 'Instabilidade', enabled: true });

    await recordNoticeDelivery(notice.id, contact.id);
    await recordNoticeDelivery(notice.id, contact.id);

    const result = await getPool().query(
      'SELECT * FROM city_notice_deliveries WHERE city_notice_id = $1 AND contact_id = $2',
      [notice.id, contact.id]
    );
    expect(result.rowCount).toBe(1);
  });
});
