const { avaliarElegibilidade, DIAS_ENTRE_LIBERACOES, MENSAGENS } = require('./trust-unlock-rules');

// Meio-dia UTC = 9h em São Paulo: o dia é o mesmo nos dois fusos, então os
// testes de contagem não dependem do TZ da máquina. O teste de fuso, abaixo,
// é o único que escolhe um horário de propósito.
const HOJE = new Date('2026-09-12T12:00:00Z');

function liberacao(createdAtIso) {
  return { id: 'l-1', contractId: 17402, protocolo: '123', liberadoDias: 3, createdAt: new Date(createdAtIso) };
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
      liberacoes: [liberacao('2026-09-01T12:00:00Z')],
      faturas: [fatura('2026-08-20', '2026-09-02')],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: false, motivo: 'intervalo_minimo', diasRestantes: DIAS_ENTRE_LIBERACOES - 11 });
  });

  test('exatos 30 dias já permitem', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-13T12:00:00Z')],
      faturas: [fatura('2026-08-10', '2026-08-14')],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('conta os dias no calendário de São Paulo, não em UTC', () => {
    // 01:30Z de 14/08 ainda é 22:30 de 13/08 em São Paulo. Em UTC seriam 29
    // dias até 12/09 (bloqueia); no fuso da operação são 30 (libera).
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-14T01:30:00Z')],
      faturas: [],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('mais de 30 dias e promessa cumprida (fatura de então paga) libera', () => {
    // O cenário do usuário: mês passado pediu, foi liberado e PAGOU.
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T12:00:00Z')],
      faturas: [fatura('2026-07-25', '2026-08-03'), fatura('2026-09-05', null)],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('mais de 30 dias mas promessa quebrada (fatura de então ainda aberta) bloqueia', () => {
    // O cenário da brecha: pediu, foi liberado, NÃO pagou, e volta a pedir.
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T12:00:00Z')],
      faturas: [fatura('2026-07-25', null), fatura('2026-09-05', null)],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: false, motivo: 'promessa_quebrada' });
  });

  test('título antigo, fora da janela de 60 dias antes da liberação, não conta como quebra', () => {
    // Um título esquecido de 2023 não pode tornar o contrato inelegível para
    // sempre com a acusação falsa de "não pagou a última liberação".
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T12:00:00Z')],
      faturas: [fatura('2023-01-10', null), fatura('2026-07-20', '2026-08-03')],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('fatura cancelada, paga ou baixada da época da liberação não conta como quebra', () => {
    for (const status of ['Cancelado', 'Pago', 'Baixado', 'Quitado']) {
      const r = avaliarElegibilidade({
        liberacoes: [liberacao('2026-08-01T12:00:00Z')],
        faturas: [fatura('2026-07-25', null, status)],
        hoje: HOJE,
      });
      expect(r).toEqual({ ok: true });
    }
  });

  test('status que só CONTÉM "pagamento" continua sendo fatura aberta', () => {
    // "Aguardando pagamento" não é pago. Tratar como pago daria uma segunda
    // liberação a quem nunca pagou.
    for (const status of ['Aguardando pagamento', 'Pagamento pendente', 'Gerado', 'Vencido']) {
      const r = avaliarElegibilidade({
        liberacoes: [liberacao('2026-08-01T12:00:00Z')],
        faturas: [fatura('2026-07-25', null, status)],
        hoje: HOJE,
      });
      expect(r).toEqual({ ok: false, motivo: 'promessa_quebrada' });
    }
  });

  test('fatura que só venceu DEPOIS da liberação não conta como quebra', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T12:00:00Z')],
      faturas: [fatura('2026-08-30', null)],
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('lista truncada pelo SGP que não alcança a janela falha fechada', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T12:00:00Z')],
      faturas: [fatura('2026-09-30', null), fatura('2026-08-30', null)],
      totalFaturas: 80,
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: false, motivo: 'historico_incompleto' });
  });

  test('lista truncada mas que já cobre a janela é avaliada normalmente', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-08-01T12:00:00Z')],
      faturas: [fatura('2026-09-30', null), fatura('2026-07-20', '2026-08-03'), fatura('2026-05-01', '2026-05-02')],
      totalFaturas: 80,
      hoje: HOJE,
    });
    expect(r).toEqual({ ok: true });
  });

  test('usa a liberação mais recente, não a primeira da lista', () => {
    const r = avaliarElegibilidade({
      liberacoes: [liberacao('2026-05-01T12:00:00Z'), liberacao('2026-09-08T12:00:00Z')],
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

// Task 19: o prazo tinha três fontes (a constante e dois números escritos à
// mão). A regra continua fixa no código — só a duplicação sai.
describe('MENSAGENS.intervalo_minimo', () => {
  test('a mensagem do intervalo entre liberações usa a constante, não um número escrito à mão', () => {
    expect(MENSAGENS.intervalo_minimo).toContain(String(DIAS_ENTRE_LIBERACOES));
  });
});
