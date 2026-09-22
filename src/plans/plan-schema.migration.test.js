const { getPool, closePool } = require('../db/pool');

describe('esquema de plans', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE plans CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('nasce ativo, sem observacao e na ordem zero', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO plans (name, monthly_price) VALUES ('500 Mega', 100) RETURNING speed_mbps, install_condition, active, sort_order, note"
    );
    expect(rows[0].speed_mbps).toBeNull();
    expect(rows[0].install_condition).toBe('');
    expect(rows[0].active).toBe(true);
    expect(rows[0].sort_order).toBe(0);
    expect(rows[0].note).toBe('');
  });

  test('preco guarda duas casas sem virar texto', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO plans (name, monthly_price) VALUES ('Teste', 99.9) RETURNING monthly_price"
    );
    expect(Number(rows[0].monthly_price)).toBe(99.9);
  });

  test('preco negativo e recusado', async () => {
    await expect(
      getPool().query("INSERT INTO plans (name, monthly_price) VALUES ('Errado', -1)")
    ).rejects.toThrow(/plans_preco_nao_negativo/);
  });

  test('velocidade zero ou negativa e recusada, mas nula e aceita', async () => {
    await expect(
      getPool().query("INSERT INTO plans (name, monthly_price, speed_mbps) VALUES ('Errado', 10, 0)")
    ).rejects.toThrow(/plans_velocidade_positiva/);

    const { rows } = await getPool().query(
      "INSERT INTO plans (name, monthly_price, speed_mbps) VALUES ('TV', 50, NULL) RETURNING speed_mbps"
    );
    expect(rows[0].speed_mbps).toBeNull();
  });
});
