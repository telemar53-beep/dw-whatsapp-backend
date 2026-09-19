const { getPool, closePool } = require('../db/pool');
const { claimDelivery, markDeliverySent, releaseDelivery, findDelivery } = require('./billing-delivery.repository');

const CONVERSA = '33333333-3333-3333-3333-333333333333';
const OUTRA_CONVERSA = '44444444-4444-4444-4444-444444444444';

const pedido = (extra = {}) => ({
  conversationId: CONVERSA,
  tool: 'enviar_boleto',
  contractId: 17402,
  invoiceId: '9',
  requestKey: 'initial',
  ...extra,
});

async function linhas() {
  const r = await getPool().query('SELECT id, sent_at FROM ai_billing_deliveries ORDER BY claimed_at');
  return r.rows;
}

describe('billing delivery repository', () => {
  // Aquece o pool ANTES das corridas. Sem conexões ociosas, a segunda chamada
  // de um Promise.all gasta o handshake inteiro do Postgres (dezenas de ms) e
  // a "corrida" vira fila: o teste passaria mesmo com um claim NÃO atômico.
  // Com o pool quente as duas partem juntas, e é a unicidade do banco — não a
  // ordem — que decide quem ganha.
  beforeAll(async () => {
    await Promise.all(Array.from({ length: 8 }, () => getPool().query('SELECT 1')));
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_billing_deliveries');
  });

  afterAll(async () => {
    await closePool();
  });

  test('o primeiro claim da fatura é obtido e grava a linha', async () => {
    const { obtido, registro } = await claimDelivery(pedido());
    expect(obtido).toBe(true);
    expect(registro.id).toEqual(expect.any(String));
    expect(registro.claimedAt).toBeInstanceOf(Date);
    expect(registro.sentAt).toBeNull();
    expect(await linhas()).toHaveLength(1);
  });

  test('o segundo claim da MESMA fatura não é obtido e devolve o registro existente', async () => {
    const primeiro = await claimDelivery(pedido());
    const segundo = await claimDelivery(pedido());
    expect(segundo.obtido).toBe(false);
    expect(segundo.registro.id).toBe(primeiro.registro.id);
    expect(await linhas()).toHaveLength(1);
  });

  // As cinco colunas juntas são a chave: mudar QUALQUER uma delas é outra
  // entrega, e tem de passar.
  test.each([
    ['outra conversa', { conversationId: OUTRA_CONVERSA }],
    ['outra ferramenta', { tool: 'gerar_pix' }],
    ['outro contrato', { contractId: 17405 }],
    ['outra fatura', { invoiceId: '10' }],
    ['outra chave de pedido', { requestKey: 'resend:msg-2' }],
  ])('%s é outra entrega e é reivindicável', async (_nome, diferenca) => {
    expect((await claimDelivery(pedido())).obtido).toBe(true);
    expect((await claimDelivery(pedido(diferenca))).obtido).toBe(true);
    expect(await linhas()).toHaveLength(2);
  });

  // O CORAÇÃO DA GUARDA. Não é "duas chamadas em sequência": são duas (e
  // depois oito) chamadas EM VOO AO MESMO TEMPO, cada uma na sua conexão do
  // pool, disputando a mesma linha no Postgres. Só o `INSERT ... ON CONFLICT
  // DO NOTHING RETURNING` decide quem ganhou — um SELECT antes do INSERT
  // deixaria as duas passarem, e o cliente receberia dois boletos.
  describe('concorrência real', () => {
    test('duas execuções SIMULTÂNEAS: só uma obtém o claim, e sobra uma linha só', async () => {
      const [a, b] = await Promise.all([claimDelivery(pedido()), claimDelivery(pedido())]);
      const obtidos = [a, b].filter((r) => r.obtido);
      expect(obtidos).toHaveLength(1);
      expect(await linhas()).toHaveLength(1);
      // A perdedora enxerga a linha da vencedora, não uma segunda linha.
      const perdedora = [a, b].find((r) => !r.obtido);
      expect(perdedora.registro.id).toBe(obtidos[0].registro.id);
      expect(perdedora.registro.sentAt).toBeNull();
    });

    test('oito execuções simultâneas: exatamente uma vencedora', async () => {
      const resultados = await Promise.all(Array.from({ length: 8 }, () => claimDelivery(pedido())));
      expect(resultados.filter((r) => r.obtido)).toHaveLength(1);
      expect(resultados.filter((r) => !r.obtido)).toHaveLength(7);
      expect(await linhas()).toHaveLength(1);
      const vencedora = resultados.find((r) => r.obtido).registro.id;
      for (const r of resultados) expect(r.registro.id).toBe(vencedora);
    });

    // Entregas DIFERENTES não disputam nada: a guarda não pode virar uma fila
    // global que atrasa ou bloqueia o boleto de outro cliente.
    test('claims simultâneos de faturas diferentes passam todos', async () => {
      const resultados = await Promise.all([
        claimDelivery(pedido({ invoiceId: '1' })),
        claimDelivery(pedido({ invoiceId: '2' })),
        claimDelivery(pedido({ invoiceId: '3' })),
      ]);
      expect(resultados.every((r) => r.obtido)).toBe(true);
      expect(await linhas()).toHaveLength(3);
    });
  });

  describe('markDeliverySent', () => {
    test('preenche sent_at, e o claim seguinte já sabe que a entrega se completou', async () => {
      const { registro } = await claimDelivery(pedido());
      await markDeliverySent(registro.id);
      const depois = await claimDelivery(pedido());
      expect(depois.obtido).toBe(false);
      expect(depois.registro.sentAt).toBeInstanceOf(Date);
    });

    test('sem id não vai ao banco', async () => {
      await expect(markDeliverySent(null)).resolves.toBeUndefined();
    });
  });

  describe('releaseDelivery', () => {
    // Zona A: nada saiu do sistema, então a próxima tentativa TEM de poder
    // entregar.
    test('apaga a linha e a entrega volta a ser reivindicável', async () => {
      const { registro } = await claimDelivery(pedido());
      await releaseDelivery(registro.id);
      expect(await linhas()).toHaveLength(0);
      expect((await claimDelivery(pedido())).obtido).toBe(true);
    });

    // Rede de baixo do `AND sent_at IS NULL`: nem um chamador enganado pode
    // apagar uma entrega já confirmada e abrir caminho para a segunda.
    test('NÃO apaga uma entrega já confirmada', async () => {
      const { registro } = await claimDelivery(pedido());
      await markDeliverySent(registro.id);
      await releaseDelivery(registro.id);
      expect(await linhas()).toHaveLength(1);
      expect((await claimDelivery(pedido())).obtido).toBe(false);
    });

    test('um id que não existe não quebra', async () => {
      await expect(releaseDelivery('55555555-5555-5555-5555-555555555555')).resolves.toBeUndefined();
      await expect(releaseDelivery(null)).resolves.toBeUndefined();
    });
  });

  describe('findDelivery', () => {
    test('devolve o claim gravado', async () => {
      const { registro } = await claimDelivery(pedido());
      const achado = await findDelivery(pedido());
      expect(achado.id).toBe(registro.id);
      expect(achado.requestKey).toBe('initial');
      expect(achado.sentAt).toBeNull();
    });

    test('uma entrega que nunca foi reivindicada devolve null', async () => {
      expect(await findDelivery(pedido())).toBeNull();
    });
  });

  // MINIMIZAÇÃO (Fase 3): a tabela guarda só ids. Nenhum valor, nenhuma linha
  // digitável, nenhum código PIX, nenhum dado pessoal — um `SELECT *` daqui
  // não pode descrever a fatura, só apontá-la.
  test('a tabela tem só colunas de id e de tempo', async () => {
    const r = await getPool().query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_billing_deliveries' ORDER BY column_name"
    );
    expect(r.rows.map((l) => l.column_name)).toEqual([
      'claimed_at', 'contract_id', 'conversation_id', 'id', 'invoice_id', 'request_key', 'sent_at', 'tool',
    ]);
  });
});
