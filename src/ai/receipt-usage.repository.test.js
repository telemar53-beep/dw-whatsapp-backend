const { getPool, closePool } = require('../db/pool');
const { claimReceipt, releaseReceipt, findReceiptUsage } = require('./receipt-usage.repository');

describe('receipt usage repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_receipts_used');
    await getPool().query("DELETE FROM contacts WHERE phone_number = '5511999990001'");
  });

  afterAll(async () => {
    await closePool();
  });

  test('o primeiro uso do comprovante é aceito', async () => {
    expect(await claimReceipt({ transactionId: 'E123', contactId: null, contractId: 26515 })).toBe(true);
    const linhas = await getPool().query('SELECT transaction_id, contract_id FROM ai_receipts_used');
    expect(linhas.rowCount).toBe(1);
    expect(linhas.rows[0]).toEqual({ transaction_id: 'E123', contract_id: 26515 });
  });

  // O ponto da tabela: o mesmo comprovante emprestado a outra pessoa não
  // libera duas vezes.
  test('o segundo uso do MESMO id é recusado, mesmo em outro contrato', async () => {
    expect(await claimReceipt({ transactionId: 'E123', contactId: null, contractId: 26515 })).toBe(true);
    expect(await claimReceipt({ transactionId: 'E123', contactId: null, contractId: 17402 })).toBe(false);
    const linhas = await getPool().query('SELECT id FROM ai_receipts_used');
    expect(linhas.rowCount).toBe(1);
  });

  test('ids diferentes passam', async () => {
    expect(await claimReceipt({ transactionId: 'E123', contactId: null, contractId: 26515 })).toBe(true);
    expect(await claimReceipt({ transactionId: 'E456', contactId: null, contractId: 26515 })).toBe(true);
  });

  // A reserva vale enquanto a liberação estiver de pé: se o SGP recusar, o
  // comprovante volta a valer — o cliente não pode perder o comprovante por
  // uma recusa que não foi dele.
  test('releaseReceipt devolve o comprovante, e ele pode ser reservado de novo', async () => {
    expect(await claimReceipt({ transactionId: 'E123', contactId: null, contractId: 26515 })).toBe(true);
    await releaseReceipt('E123');
    expect(await getPool().query('SELECT id FROM ai_receipts_used')).toMatchObject({ rowCount: 0 });
    expect(await claimReceipt({ transactionId: 'E123', contactId: null, contractId: 26515 })).toBe(true);
  });

  test('releaseReceipt de um id que não está reservado não quebra', async () => {
    await expect(releaseReceipt('E-que-nunca-existiu')).resolves.not.toThrow();
  });

  // Quem já usou o comprovante, em qual contrato e quando: é o que a triagem
  // conta à atendente no resumo (e nunca ao cliente).
  describe('findReceiptUsage', () => {
    test('devolve o contato, o contrato e a hora do uso anterior', async () => {
      const contato = await getPool().query(
        "INSERT INTO contacts (phone_number, display_name) VALUES ('5511999990001', 'Fulano') RETURNING id"
      );
      const antes = new Date();
      await claimReceipt({ transactionId: 'E123', contactId: contato.rows[0].id, contractId: 26515 });

      const uso = await findReceiptUsage('E123');
      expect(uso.contactId).toBe(contato.rows[0].id);
      expect(uso.contractId).toBe(26515);
      expect(uso.usedAt).toBeInstanceOf(Date);
      expect(uso.usedAt.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
    });

    test('um id que nunca foi usado devolve null', async () => {
      expect(await findReceiptUsage('E-que-nunca-existiu')).toBeNull();
    });

    test('id vazio ou ausente não vai ao banco', async () => {
      expect(await findReceiptUsage(null)).toBeNull();
      expect(await findReceiptUsage('')).toBeNull();
    });

    // O uso é devolvido junto com o comprovante quando a liberação não vinga:
    // depois disso não há mais uso anterior nenhum a contar.
    test('depois do releaseReceipt não há mais uso anterior', async () => {
      await claimReceipt({ transactionId: 'E123', contactId: null, contractId: 26515 });
      await releaseReceipt('E123');
      expect(await findReceiptUsage('E123')).toBeNull();
    });
  });

  test('grava o contato quando ele existe', async () => {
    const contato = await getPool().query(
      "INSERT INTO contacts (phone_number, display_name) VALUES ('5511999990001', 'Fulano') RETURNING id"
    );
    expect(await claimReceipt({ transactionId: 'E789', contactId: contato.rows[0].id, contractId: null })).toBe(true);
    const linha = await getPool().query('SELECT contact_id, contract_id FROM ai_receipts_used WHERE transaction_id = $1', ['E789']);
    expect(linha.rows[0].contact_id).toBe(contato.rows[0].id);
    expect(linha.rows[0].contract_id).toBeNull();
  });
});
