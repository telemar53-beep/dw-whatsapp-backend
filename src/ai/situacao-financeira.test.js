const {
  hojeEmSaoPaulo, classificarTitulo, analisarSituacaoFinanceiraContrato, decidirCobranca, pagamentoConfirmadoDoTitulo,
  descreverReativacao,
} = require('./situacao-financeira');

// Regra financeira 0 / 1 / 2+ (25/09/2026), com a semântica REAL do SGP da DW auditada em produção:
// contratoStatus 1 Ativo / 3 Cancelado / 4 Suspenso; título statusid 1 "Gerado" sem data_pagamento
// (não pago) e statusid 2 "Pago" com data_pagamento. A listagem traz pagas, atuais e o carnê futuro
// inteiro, e o SGP muda o vencimento_atualizado do atrasado para o dia corrente — atraso se conta
// SÓ pelo vencimento ORIGINAL. Títulos sintéticos (ids e datas inventados).
const HOJE = '2026-09-25';
const gerado = (faturaId, vencimentoOriginal, extra = {}) => ({
  faturaId, status: 'Gerado', statusCode: 1, vencimentoOriginal, vencimentoAtualizado: vencimentoOriginal, dataPagamento: null, ...extra,
});
const pago = (faturaId, vencimentoOriginal) => ({
  faturaId, status: 'Pago', statusCode: 2, vencimentoOriginal, vencimentoAtualizado: vencimentoOriginal, dataPagamento: `${vencimentoOriginal} 10:00:00`,
});
const ATIVO = { id: 5001, statusCode: 1 };
const analisar = (titulos, extra = {}) => analisarSituacaoFinanceiraContrato({ contrato: ATIVO, titulos, hoje: HOJE, leituraCompleta: true, ...extra });

describe('hoje no calendário de São Paulo', () => {
  test('às 22h de São Paulo (01h UTC do dia seguinte) ainda é o dia de São Paulo', () => {
    expect(hojeEmSaoPaulo(new Date('2026-09-26T01:00:00Z'))).toBe('2026-09-25');
    expect(hojeEmSaoPaulo(new Date('2026-09-25T03:30:00Z'))).toBe('2026-09-25');
  });
});

describe('classificação de cada título', () => {
  test('1. Gerado, statusid 1, sem pagamento, venceu ontem → vencida', () => {
    expect(classificarTitulo(gerado(1, '2026-09-24'), HOJE)).toEqual({ classe: 'vencida' });
  });

  test('2. a mesma situação vencendo hoje → do dia, NÃO vencida', () => {
    expect(classificarTitulo(gerado(1, HOJE), HOJE)).toEqual({ classe: 'do_dia' });
  });

  test('3. vencendo amanhã → futura', () => {
    expect(classificarTitulo(gerado(1, '2026-09-26'), HOJE)).toEqual({ classe: 'futura' });
  });

  test('4. Pago, statusid 2, com data de pagamento e vencimento antigo → paga, não vencida', () => {
    expect(classificarTitulo(pago(1, '2025-01-10'), HOJE)).toEqual({ classe: 'paga' });
  });

  test('5. caso real: vencimento original antigo + vencimento_atualizado HOJE → continua vencida', () => {
    expect(classificarTitulo(gerado(609690, '2026-09-10', { vencimentoAtualizado: HOJE }), HOJE)).toEqual({ classe: 'vencida' });
  });

  test('data no formato DD/MM/AAAA também é lida', () => {
    expect(classificarTitulo(gerado(1, '10/09/2026'), HOJE)).toEqual({ classe: 'vencida' });
  });

  test('8. status desconhecido ou incoerente → indeterminado', () => {
    expect(classificarTitulo({ ...gerado(1, '2026-09-10'), statusCode: 3, status: 'Cancelado' }, HOJE).classe).toBe('indeterminado');
    expect(classificarTitulo({ ...gerado(1, '2026-09-10'), status: 'Em aberto' }, HOJE).classe).toBe('indeterminado');
    expect(classificarTitulo({ ...gerado(1, '2026-09-10'), dataPagamento: '2026-09-11' }, HOJE).classe).toBe('indeterminado');
    expect(classificarTitulo({ ...pago(1, '2026-09-10'), dataPagamento: null }, HOJE).classe).toBe('indeterminado');
  });

  test('9. data ilegível → indeterminado', () => {
    expect(classificarTitulo(gerado(1, 'amanhã'), HOJE).classe).toBe('indeterminado');
    expect(classificarTitulo(gerado(1, null), HOJE).classe).toBe('indeterminado');
  });

  test('statusid chega como texto "1"/"2" (API form-encoded): mesma leitura', () => {
    expect(classificarTitulo({ ...gerado(1, '2026-09-10'), statusCode: '1' }, HOJE)).toEqual({ classe: 'vencida' });
    expect(classificarTitulo({ ...pago(1, '2026-09-10'), statusCode: '2' }, HOJE)).toEqual({ classe: 'paga' });
  });
});

describe('análise de UM contrato', () => {
  test('6. carnê: 4 futuras + 1 vencida + várias pagas → 1 vencida', () => {
    const a = analisar([
      gerado(609696, '2027-01-10'), gerado(609695, '2026-12-10'), gerado(609694, '2026-11-10'), gerado(609693, '2026-10-10'),
      gerado(609690, '2026-09-10', { vencimentoAtualizado: HOJE }),
      pago(601602, '2026-08-10'), pago(586264, '2026-07-10'), pago(574441, '2026-06-10'),
    ]);
    expect(a.indeterminado).toBe(false);
    expect(a.quantidadeVencidas).toBe(1);
    expect(a.maisAntiga.faturaId).toBe(609690);
    expect(a.futuras).toHaveLength(4);
    expect(a.pagas).toHaveLength(3);
  });

  test('7. 4 vencidas, na ordem que a API mandar → a mais antiga pelo vencimento ORIGINAL', () => {
    const a = analisar([
      gerado(710004, '2026-09-10', { vencimentoAtualizado: HOJE }), gerado(710001, '2026-06-10', { vencimentoAtualizado: HOJE }),
      gerado(710003, '2026-08-10', { vencimentoAtualizado: HOJE }), gerado(710002, '2026-07-10', { vencimentoAtualizado: HOJE }),
      gerado(710005, '2026-10-10'),
    ]);
    expect(a.quantidadeVencidas).toBe(4);
    expect(a.vencidas.map((t) => t.faturaId)).toEqual([710001, 710002, 710003, 710004]);
    expect(a.maisAntiga.faturaId).toBe(710001);
  });

  test('19. empate de vencimento → o menor id vence, sempre', () => {
    const a = analisar([gerado(800009, '2026-08-10'), gerado(800002, '2026-08-10'), gerado(800005, '2026-08-10')]);
    expect(a.maisAntiga.faturaId).toBe(800002);
    expect(a.vencidas.map((t) => t.faturaId)).toEqual([800002, 800005, 800009]);
  });

  test('10. leitura incompleta → indeterminado', () => {
    const a = analisar([gerado(1, '2026-09-10')], { leituraCompleta: false });
    expect(a).toMatchObject({ indeterminado: true, motivoIndeterminado: 'leitura_incompleta' });
  });

  test('um título indeterminado torna o contrato indeterminado (nunca adivinhar)', () => {
    const a = analisar([gerado(1, '2026-09-10'), { ...gerado(2, '2026-08-10'), statusCode: 9 }]);
    expect(a).toMatchObject({ indeterminado: true, motivoIndeterminado: 'titulo_indeterminado' });
  });

  test('status do contrato: 1 ativo, 4 suspenso, 3 cancelado; outro código → indeterminado', () => {
    expect(analisarSituacaoFinanceiraContrato({ contrato: { id: 1, statusCode: 4 }, titulos: [], hoje: HOJE, leituraCompleta: true }).contratoStatus).toBe('suspenso');
    const cancelado = analisarSituacaoFinanceiraContrato({ contrato: { id: 1, statusCode: 3 }, titulos: [], hoje: HOJE, leituraCompleta: false });
    expect(cancelado).toMatchObject({ cancelado: true, contratoStatus: 'cancelado' });
    const inativo = analisarSituacaoFinanceiraContrato({ contrato: { id: 1, statusCode: 2 }, titulos: [gerado(1, '2026-10-10')], hoje: HOJE, leituraCompleta: true });
    expect(inativo).toMatchObject({ indeterminado: true, motivoIndeterminado: 'status_do_contrato_nao_confirmado' });
  });

  test('status do contrato não disponível (contrato de terceiro): vale só a regra dos títulos', () => {
    const a = analisarSituacaoFinanceiraContrato({ contrato: { id: 77 }, titulos: [gerado(1, '2026-09-10')], hoje: HOJE, leituraCompleta: true });
    expect(a).toMatchObject({ indeterminado: false, contratoStatus: null, quantidadeVencidas: 1 });
  });
});

describe('decisão da cobrança (dia x noite com autoatendimento)', () => {
  const DIA = { noturnoAutoatendimento: false };
  const NOITE = { noturnoAutoatendimento: true };
  const vencidas = (n) => analisar(Array.from({ length: n }, (_, i) => gerado(900000 + i, `2026-0${i + 1}-10`)));

  test('11. 0 vencidas → fluxo normal (a regra de inadimplência não se aplica)', () => {
    expect(decidirCobranca(analisar([gerado(1, '2026-10-10'), pago(2, '2026-08-10')]), DIA)).toEqual({ acao: 'fluxo_normal' });
  });

  test('12. 1 vencida → autoriza somente ela', () => {
    expect(decidirCobranca(vencidas(1), DIA)).toEqual({ acao: 'entregar', faturaPermitida: 900000, reativacaoDepois: false });
  });

  test('13/14. 2 ou 4 vencidas de dia → nenhuma cobrança, Reativação', () => {
    expect(decidirCobranca(vencidas(2), DIA)).toEqual({ acao: 'reativacao', motivo: 'multiplas_vencidas', quantidadeVencidas: 2 });
    expect(decidirCobranca(vencidas(4), DIA)).toEqual({ acao: 'reativacao', motivo: 'multiplas_vencidas', quantidadeVencidas: 4 });
  });

  test('15. cancelado → Reativação sem entrega, mesmo sem título vencido', () => {
    const cancelado = analisarSituacaoFinanceiraContrato({ contrato: { id: 1, statusCode: 3 }, titulos: [], hoje: HOJE, leituraCompleta: true });
    expect(decidirCobranca(cancelado, NOITE)).toEqual({ acao: 'reativacao', motivo: 'contrato_cancelado' });
  });

  test('16. noite com autoatendimento + 4 vencidas → só a MAIS ANTIGA, e Reativação depois', () => {
    expect(decidirCobranca(vencidas(4), NOITE)).toEqual({ acao: 'entregar', faturaPermitida: 900000, reativacaoDepois: true, quantidadeVencidas: 4 });
  });

  test('17/18. sem o noturno com autoatendimento → regra conservadora do dia', () => {
    expect(decidirCobranca(vencidas(3), { noturnoAutoatendimento: false }).acao).toBe('reativacao');
    expect(decidirCobranca(vencidas(3), {}).acao).toBe('reativacao');
  });

  test('1 vencida à noite: o fluxo seguro de sempre (só ela, sem Reativação obrigatória)', () => {
    expect(decidirCobranca(vencidas(1), NOITE)).toEqual({ acao: 'entregar', faturaPermitida: 900000, reativacaoDepois: false });
  });

  test('indeterminado → humano, sem entrega', () => {
    expect(decidirCobranca(analisar([gerado(1, '2026-09-10')], { leituraCompleta: false }), DIA))
      .toEqual({ acao: 'humano', motivo: 'leitura_incompleta' });
  });
});

describe('pagamento confirmado do MESMO título', () => {
  test('23. statusid 2 + Pago + data de pagamento → confirmado', () => {
    expect(pagamentoConfirmadoDoTitulo(pago(1, '2026-09-10'))).toBe(true);
  });

  test('21/22. ainda Gerado → não confirmado', () => {
    expect(pagamentoConfirmadoDoTitulo(gerado(1, '2026-09-10'))).toBe(false);
  });

  test('25. Pago sem data de pagamento → NÃO é confirmação suficiente', () => {
    expect(pagamentoConfirmadoDoTitulo({ ...pago(1, '2026-09-10'), dataPagamento: null })).toBe(false);
  });

  test('título ausente → não confirmado', () => {
    expect(pagamentoConfirmadoDoTitulo(null)).toBe(false);
  });
});

describe('motivo de reativação no resumo', () => {
  test('cada motivo tem texto próprio, sem nome de setor com maiúscula', () => {
    for (const motivo of ['contrato_cancelado', 'multiplas_vencidas', 'multiplas_vencidas_noturno']) {
      expect(descreverReativacao(motivo)).not.toMatch(/(Financeiro|Comercial|Reativação)/);
    }
    expect(descreverReativacao('multiplas_vencidas_noturno')).toMatch(/mais antiga/);
    expect(descreverReativacao('contrato_cancelado')).toMatch(/cancelado/);
  });
});
