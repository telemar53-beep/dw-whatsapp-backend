const { getPool, closePool } = require('../db/pool');
const { claimDelivery, markDeliveryEnqueued, releaseDelivery, findDelivery } = require('./billing-delivery.repository');

const CONVERSA = '33333333-3333-3333-3333-333333333333';
const OUTRA_CONVERSA = '44444444-4444-4444-4444-444444444444';

const pedido = (extra = {}) => ({
  conversationId: CONVERSA,
  tool: 'enviar_boleto',
  contractId: 17402,
  invoiceId: '9',
  messageId: 'msg-1',
  isResend: false,
  ...extra,
});

/** A mesma mensagem, agora pedindo o reenvio: identidade igual, permissão nova. */
const reenvio = (extra = {}) => pedido({ isResend: true, ...extra });

async function linhas() {
  const r = await getPool().query('SELECT id, message_id, is_resend, enqueued_at FROM ai_billing_deliveries ORDER BY claimed_at');
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

  // =========================================================================
  // OS SETE CASOS QUE PRECISAM VALER, contra o Postgres de verdade.
  //
  // A identidade da entrega é a MENSAGEM INBOUND; `reenviar` (is_resend) é só
  // permissão. Quem garante as duas propriedades são as duas restrições da
  // tabela, e NENHUMA delas é conferida em JavaScript:
  //   1. UNIQUE (conversa, ferramenta, contrato, fatura, message_id)
  //   2. índice parcial único WHERE is_resend = false
  // =========================================================================
  describe('os sete casos', () => {
    test('1. primeiro envio passa', async () => {
      const { obtido, registro } = await claimDelivery(pedido());
      expect(obtido).toBe(true);
      expect(registro.id).toEqual(expect.any(String));
      expect(registro.messageId).toBe('msg-1');
      expect(registro.isResend).toBe(false);
      expect(registro.claimedAt).toBeInstanceOf(Date);
      expect(registro.enqueuedAt).toBeNull();
      expect(await linhas()).toHaveLength(1);
    });

    test('2. segunda call na MESMA mensagem bloqueia', async () => {
      const primeiro = await claimDelivery(pedido());
      const segundo = await claimDelivery(pedido());
      expect(segundo.obtido).toBe(false);
      expect(segundo.registro.id).toBe(primeiro.registro.id);
      expect(await linhas()).toHaveLength(1);
    });

    // ===== O MOTIVO DESTA RODADA =========================================
    // Medido em banco real na v1: claimDelivery(...,'initial') GANHOU e
    // claimDelivery(...,'resend:msg-1') GANHOU também — duas linhas, duas
    // entregas da mesma fatura, na MESMA mensagem do cliente. Agora a
    // identidade é a mensagem, então a UNIQUE composta bloqueia.
    test('3. mesma mensagem, sem reenviar e depois COM reenviar: bloqueia', async () => {
      const primeiro = await claimDelivery(pedido());
      const segundo = await claimDelivery(reenvio());
      expect(primeiro.obtido).toBe(true);
      expect(segundo.obtido).toBe(false);
      expect(segundo.registro.id).toBe(primeiro.registro.id);
      expect(await linhas()).toHaveLength(1);
    });

    test('3b. a ordem inversa na mesma mensagem também bloqueia', async () => {
      expect((await claimDelivery(reenvio())).obtido).toBe(true);
      expect((await claimDelivery(pedido())).obtido).toBe(false);
      expect(await linhas()).toHaveLength(1);
    });

    // Aqui a UNIQUE composta não encosta (a mensagem é nova): quem bloqueia é
    // o índice parcial `WHERE is_resend = false`.
    test('4. mensagem NOVA sem reenviar bloqueia, porque já houve o envio inicial', async () => {
      expect((await claimDelivery(pedido({ messageId: 'msg-1' }))).obtido).toBe(true);
      const segundo = await claimDelivery(pedido({ messageId: 'msg-2' }));
      expect(segundo.obtido).toBe(false);
      // A linha que bloqueou é a do envio inicial, de outra mensagem.
      expect(segundo.registro.messageId).toBe('msg-1');
      expect(await linhas()).toHaveLength(1);
    });

    test('5. mensagem nova com reenviar passa uma vez', async () => {
      await claimDelivery(pedido({ messageId: 'msg-1' }));
      expect((await claimDelivery(reenvio({ messageId: 'msg-2' }))).obtido).toBe(true);
      expect(await linhas()).toHaveLength(2);
    });

    test('6. duas calls de reenvio na mesma mensagem: uma passa', async () => {
      await claimDelivery(pedido({ messageId: 'msg-1' }));
      expect((await claimDelivery(reenvio({ messageId: 'msg-2' }))).obtido).toBe(true);
      expect((await claimDelivery(reenvio({ messageId: 'msg-2' }))).obtido).toBe(false);
      expect(await linhas()).toHaveLength(2);
    });

    test('7. outra mensagem futura pedindo reenvio passa de novo', async () => {
      await claimDelivery(pedido({ messageId: 'msg-1' }));
      await claimDelivery(reenvio({ messageId: 'msg-2' }));
      expect((await claimDelivery(reenvio({ messageId: 'msg-3' }))).obtido).toBe(true);
      expect(await linhas()).toHaveLength(3);
      // Um envio inicial e dois reenvios: o índice parcial nunca vê os dois
      // últimos, e é por isso que eles passam.
      expect((await linhas()).filter((l) => !l.is_resend)).toHaveLength(1);
    });
  });

  // As quatro colunas da fatura mais a mensagem são a identidade: mudar
  // QUALQUER uma delas é outra entrega, e tem de passar.
  test.each([
    ['outra conversa', { conversationId: OUTRA_CONVERSA }],
    ['outra ferramenta', { tool: 'gerar_pix' }],
    ['outro contrato', { contractId: 17405 }],
    ['outra fatura', { invoiceId: '10' }],
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
      expect(perdedora.registro.enqueuedAt).toBeNull();
    });

    test('oito execuções simultâneas: exatamente uma vencedora', async () => {
      const resultados = await Promise.all(Array.from({ length: 8 }, () => claimDelivery(pedido())));
      expect(resultados.filter((r) => r.obtido)).toHaveLength(1);
      expect(resultados.filter((r) => !r.obtido)).toHaveLength(7);
      expect(await linhas()).toHaveLength(1);
      const vencedora = resultados.find((r) => r.obtido).registro.id;
      for (const r of resultados) expect(r.registro.id).toBe(vencedora);
    });

    // NOVA NA v2, e é a segunda restrição sozinha: mensagens DIFERENTES, as
    // duas sem reenviar. A UNIQUE composta não encosta nelas (os message_id
    // diferem), então quem tem de decidir é o índice parcial — e ele decide
    // dentro do Postgres, não em JavaScript.
    describe('corrida no envio INICIAL, com message_id diferentes', () => {
      test('duas simultâneas, nenhuma de reenvio: exatamente uma ganha', async () => {
        const [a, b] = await Promise.all([
          claimDelivery(pedido({ messageId: 'msg-1' })),
          claimDelivery(pedido({ messageId: 'msg-2' })),
        ]);
        expect([a, b].filter((r) => r.obtido)).toHaveLength(1);
        expect(await linhas()).toHaveLength(1);
        // A perdedora enxerga a linha da vencedora, de OUTRA mensagem.
        const vencedora = [a, b].find((r) => r.obtido).registro;
        expect([a, b].find((r) => !r.obtido).registro.id).toBe(vencedora.id);
      });

      test('oito simultâneas com oito mensagens diferentes: exatamente uma ganha', async () => {
        const resultados = await Promise.all(
          Array.from({ length: 8 }, (_, i) => claimDelivery(pedido({ messageId: `msg-${i}` })))
        );
        expect(resultados.filter((r) => r.obtido)).toHaveLength(1);
        expect(await linhas()).toHaveLength(1);
      });

      // O reenvio explícito NÃO pode ficar preso nessa mesma corrida: o índice
      // é parcial de propósito.
      test('reenvios simultâneos de mensagens diferentes passam todos', async () => {
        await claimDelivery(pedido({ messageId: 'msg-0' }));
        const resultados = await Promise.all([
          claimDelivery(reenvio({ messageId: 'msg-1' })),
          claimDelivery(reenvio({ messageId: 'msg-2' })),
          claimDelivery(reenvio({ messageId: 'msg-3' })),
        ]);
        expect(resultados.every((r) => r.obtido)).toBe(true);
        expect(await linhas()).toHaveLength(4);
      });
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

  describe('markDeliveryEnqueued', () => {
    test('preenche enqueued_at, e o claim seguinte já sabe que a entrega saiu', async () => {
      const { registro } = await claimDelivery(pedido());
      await markDeliveryEnqueued(registro.id);
      const depois = await claimDelivery(pedido());
      expect(depois.obtido).toBe(false);
      expect(depois.registro.enqueuedAt).toBeInstanceOf(Date);
    });

    // Caso 4 visto pelo outro lado: a mensagem nova lê o enqueued_at da
    // mensagem ANTERIOR, que é a linha que bloqueou.
    test('a mensagem seguinte lê o enqueued_at do envio inicial que a bloqueou', async () => {
      const { registro } = await claimDelivery(pedido({ messageId: 'msg-1' }));
      await markDeliveryEnqueued(registro.id);
      const depois = await claimDelivery(pedido({ messageId: 'msg-2' }));
      expect(depois.obtido).toBe(false);
      expect(depois.registro.enqueuedAt).toBeInstanceOf(Date);
      expect(depois.registro.messageId).toBe('msg-1');
    });

    test('sem id não vai ao banco', async () => {
      await expect(markDeliveryEnqueued(null)).resolves.toBeUndefined();
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

    // Liberar o envio inicial devolve a vaga do índice parcial: uma mensagem
    // NOVA sem reenviar volta a poder entregar, porque nada saiu.
    test('liberado o inicial, outra mensagem sem reenviar volta a poder entregar', async () => {
      const { registro } = await claimDelivery(pedido({ messageId: 'msg-1' }));
      await releaseDelivery(registro.id);
      expect((await claimDelivery(pedido({ messageId: 'msg-2' }))).obtido).toBe(true);
    });

    // Rede de baixo do `AND enqueued_at IS NULL`: nem um chamador enganado
    // pode apagar uma entrega já enfileirada e abrir caminho para a segunda.
    test('NÃO apaga uma entrega já enfileirada', async () => {
      const { registro } = await claimDelivery(pedido());
      await markDeliveryEnqueued(registro.id);
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
      expect(achado.messageId).toBe('msg-1');
      expect(achado.isResend).toBe(false);
      expect(achado.enqueuedAt).toBeNull();
    });

    test('uma entrega que nunca foi reivindicada devolve null', async () => {
      expect(await findDelivery(pedido())).toBeNull();
    });
  });

  // As DUAS restrições existem mesmo, com os nomes e a forma que o claim
  // depende: se alguém trocar a UNIQUE composta ou tirar o WHERE do índice
  // parcial, este teste cai antes de a guarda falhar em produção.
  describe('as duas restrições estão no banco', () => {
    test('a UNIQUE composta inclui message_id', async () => {
      const r = await getPool().query(`
        SELECT a.attname FROM pg_constraint c
          JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conname = 'ai_billing_deliveries_por_mensagem' AND c.contype = 'u'
         ORDER BY k.ord`);
      expect(r.rows.map((l) => l.attname))
        .toEqual(['conversation_id', 'tool', 'contract_id', 'invoice_id', 'message_id']);
    });

    test('o índice do envio inicial é ÚNICO e PARCIAL em is_resend = false', async () => {
      const r = await getPool().query(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'ai_billing_deliveries_envio_inicial'"
      );
      expect(r.rows).toHaveLength(1);
      const definicao = r.rows[0].indexdef;
      expect(definicao).toMatch(/CREATE UNIQUE INDEX/);
      expect(definicao).toMatch(/\(conversation_id, tool, contract_id, invoice_id\)/);
      expect(definicao).toMatch(/WHERE \(is_resend = false\)/);
    });
  });

  // MINIMIZAÇÃO (Fase 3): a tabela guarda só ids. Nenhum valor, nenhuma linha
  // digitável, nenhum código PIX, nenhum dado pessoal — um `SELECT *` daqui
  // não pode descrever a fatura, só apontá-la.
  test('a tabela tem só colunas de id, de permissão e de tempo', async () => {
    const r = await getPool().query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_billing_deliveries' ORDER BY column_name"
    );
    expect(r.rows.map((l) => l.column_name)).toEqual([
      'claimed_at', 'contract_id', 'conversation_id', 'enqueued_at', 'id', 'invoice_id', 'is_resend', 'message_id', 'tool',
    ]);
  });
});
