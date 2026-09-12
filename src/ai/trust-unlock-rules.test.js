const { avaliarElegibilidade, DIAS_ENTRE_LIBERACOES } = require('./trust-unlock-rules');

const HOJE = new Date('2026-09-12T15:00:00');

function liberacao(createdAt) {
  return { id: 'l-1', contractId: 17402, protocolo: '123', liberadoDias: 3, createdAt: new Date(createdAt) };
}

function fatura(vencimentoOriginal, dataPagamento, status = 'Gerado') {
  return { faturaId: 1, status, vencimentoOriginal, dataPagamento, valorOriginal: 99.9 };
}

describe('avaliarElegibilidade (desbloqueio em confiança)', () => {
  test('sem liberação anterior e sem promessa no mês, libera', () => {
    expect(avaliarElegibilidade({ liberacoes: [], faturas: [fatura('2026-09-05', null)], hoje: HOJE })).toEqual({ ok: true });
  });

  test('contador do SGP no mês corrente bloqueia, mesmo sem registro nosso', () => {
    // Liberação feita por fora (app da Central, atendente no SGP) — o SGP conta.
    const r = avaliarElegibilidade({ liberacoes: [], faturas: [], promessasPagamentoMes: 1, hoje: HOJE });
    expect(r).toEqual({ ok: false, motivo: 'ja_liberado_este_mes' });
  });

  test('última liberação há menos de 30 dias bloqueia, mesmo com tudo pago', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-09-01T08:00:00')],
      faturas: [fatura('2026-08-20', '2026-09-02')],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: false, motivo: 'intervalo_minimo', diasRestantes: DIAS_ENTRE_LIBERACOES - 11 });
  });

  test('exatos 30 dias já permitem', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-13T23:59:59')],
      faturas: [fatura('2026-08-10', '2026-08-14')],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('mais de 30 dias e promessa cumprida (fatura de então paga) libera', () => {
    // O cenário do usuário: mês passado pediu, foi liberado e PAGOU.
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T08:00:00')],
      faturas: [fatura('2026-07-25', '2026-08-03'), fatura('2026-09-05', null)],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('mais de 30 dias mas promessa quebrada (fatura de então ainda aberta) bloqueia', () => {
    // O cenário da brecha: pediu, foi liberado, NÃO pagou, e volta a pedir.
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T08:00:00')],
      faturas: [fatura('2026-07-25', null), fatura('2026-09-05', null)],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: false, motivo: 'promessa_quebrada' });
  });

  test('fatura cancelada da época da liberação não conta como quebra', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T08:00:00')],
      faturas: [fatura('2026-07-25', null, 'Cancelado')],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('fatura que só venceu DEPOIS da liberação não conta como quebra', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T08:00:00')],
      faturas: [fatura('2026-08-30', null)],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('usa a liberação mais recente, não a primeira da lista', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-05-01T08:00:00'), liberacao('2026-09-08T08:00:00')],
      faturas: [],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: false, motivo: 'intervalo_minimo', diasRestantes: DIAS_ENTRE_LIBERACOES - 4 });
  });

  test('aceita createdAt como texto vindo do banco', () => {
    const r = avaliarElegibilidade({ liberacoes: [{ createdAt: '2026-09-10 08:00:00' }], faturas: [], hoje: HOJE });
    expect(r.motivo).toBe('intervalo_minimo');
  });
});
