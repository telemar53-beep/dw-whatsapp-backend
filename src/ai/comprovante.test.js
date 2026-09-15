const { conferirComprovante, PROMPT_VISAO, JANELA_DIAS } = require('./comprovante');

// Fuso fixo no teste: a janela de dias é contada em São Paulo, não em UTC.
const HOJE = new Date('2026-09-13T22:00:00-03:00');
const FATURAS = [{ id: '4321', value: 135, dueDate: '2026-09-16' }, { id: '4322', value: 89.9, dueDate: '2026-09-20' }];
const LEITURA = { ehComprovante: true, tipo: 'pix', valor: 135, data: '2026-09-13', favorecido: 'DW TELECOM LTDA', banco: 'Nubank', confianca: 0.92 };

test('comprovante válido: favorecido, data e valor conferem, e acha a fatura', () => {
  const r = conferirComprovante({ leitura: LEITURA, faturas: FATURAS, nomesAceitos: ['DW', 'DW Telecom'], hoje: HOJE });
  expect(r).toMatchObject({ valido: true, favorecidoConfere: true, dataConfere: true, valorConfere: true, faturaId: '4321', tipo: 'pix', valor: 135, data: '2026-09-13', motivos: [] });
});

test('valor com diferença de até 5 centavos confere; acima não', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, valor: 135.04 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).valorConfere).toBe(true);
  const r = conferirComprovante({ leitura: { ...LEITURA, valor: 130 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE });
  expect(r.valido).toBe(false);
  expect(r.motivos).toContain('valor não corresponde a nenhuma fatura em aberto');
});

test('favorecido sem DW nem o nome do recebedor não confere (sem acento/caixa)', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, favorecido: 'Loja do João' }, faturas: FATURAS, nomesAceitos: ['DW', 'Dw Telecom'], hoje: HOJE }).favorecidoConfere).toBe(false);
  expect(conferirComprovante({ leitura: { ...LEITURA, favorecido: 'dw telecom ltda' }, faturas: FATURAS, nomesAceitos: ['DW Telecom'], hoje: HOJE }).favorecidoConfere).toBe(true);
});

// A janela subiu de 7 para 15 dias: o desbloqueio noturno atende quem já
// passou dos 10 dias de atraso, e o comprovante dele é mais velho que uma semana.
test('data velha (16 dias) ou futura não confere; 15 dias atrás confere', () => {
  expect(JANELA_DIAS).toBe(15);
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-08-28' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(false);
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-08-29' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(true);
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-09-14' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(false);
});

// O ID da transação é o que impede um comprovante emprestado de desbloquear
// duas vezes: sem ele lido, não há como marcar o comprovante como usado.
describe('id da transação', () => {
  const comId = (idTransacao) => conferirComprovante({
    leitura: { ...LEITURA, idTransacao }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE,
  }).idTransacao;

  test('o prompt de visão pede o identificador da transação', () => {
    expect(PROMPT_VISAO).toContain('idTransacao');
  });

  test('devolve o id lido, limpo de espaços', () => {
    expect(comId('E18236120202609131200abcdef123456')).toBe('E18236120202609131200abcdef123456');
    expect(comId('  E1823612 0202609131200 abcdef  ')).toBe('E18236120202609131200abcdef');
  });

  test('sem id legível devolve null, e o comprovante continua podendo ser válido', () => {
    expect(comId(null)).toBeNull();
    expect(comId('   ')).toBeNull();
    expect(comId(undefined)).toBeNull();
    expect(conferirComprovante({ leitura: LEITURA, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).valido).toBe(true);
  });

  test('id que não é texto, ou longo demais, não passa inteiro adiante', () => {
    expect(comId(12345)).toBeNull();
    expect(comId('E'.repeat(200))).toHaveLength(80);
  });
});

test('não é comprovante ou confiança baixa: inválido com motivo', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, ehComprovante: false }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).motivos).toContain('a imagem não parece um comprovante de pagamento');
  expect(conferirComprovante({ leitura: { ...LEITURA, confianca: 0.3 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).valido).toBe(false);
});

test('leitura malformada (valor como texto, data em outro formato) não derruba: trata como não conferido', () => {
  const r = conferirComprovante({ leitura: { ehComprovante: true, valor: 'cento e trinta', data: '13/09/2026', favorecido: null, confianca: 0.9 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE });
  expect(r.valido).toBe(false);
  expect(r.valorConfere).toBe(false);
  expect(r.dataConfere).toBe(false);
  expect(r.favorecidoConfere).toBe(false);
});

test('o prompt de visão pede só JSON com os campos esperados', () => {
  expect(PROMPT_VISAO).toMatch(/ehComprovante/);
  expect(PROMPT_VISAO).toMatch(/favorecido/);
  expect(PROMPT_VISAO).toMatch(/Responda SOMENTE com JSON/);
});

// Fix round 1, achado 1 (crítico): `String(null || '')` virava Number('') = 0,
// que é finito e casa com uma fatura de value null/''/0 — o comprovante sem
// valor lido saía "válido" e liberava o cliente sem nada conferido.
describe('fix round 1: valor não lido nunca vira zero', () => {
  test('valor null com fatura sem valor no SGP não confere', () => {
    const r = conferirComprovante({
      leitura: { ...LEITURA, valor: null },
      faturas: [{ id: '4321', value: null, dueDate: '2026-09-16' }],
      nomesAceitos: ['DW'], hoje: HOJE,
    });
    expect(r.valorConfere).toBe(false);
    expect(r.valor).toBeNull();
    expect(r.faturaId).toBeNull();
    expect(r.valido).toBe(false);
  });

  test('valor zero não confere nem com fatura zerada', () => {
    const r = conferirComprovante({
      leitura: { ...LEITURA, valor: 0 },
      faturas: [{ id: '4321', value: 0, dueDate: '2026-09-16' }],
      nomesAceitos: ['DW'], hoje: HOJE,
    });
    expect(r.valorConfere).toBe(false);
    expect(r.valor).toBeNull();
  });

  test('texto vazio ou só espaço também não vira zero', () => {
    const vazio = conferirComprovante({ leitura: { ...LEITURA, valor: '' }, faturas: [{ id: 'a', value: 0 }], nomesAceitos: ['DW'], hoje: HOJE });
    expect(vazio.valor).toBeNull();
    expect(vazio.valorConfere).toBe(false);
    expect(conferirComprovante({ leitura: { ...LEITURA, valor: '   ' }, faturas: [{ id: 'a', value: 0 }], nomesAceitos: ['DW'], hoje: HOJE }).valorConfere).toBe(false);
  });

  test('fatura com valor imprestável é ignorada, e a boa ainda é achada', () => {
    const r = conferirComprovante({
      leitura: LEITURA,
      faturas: [{ id: 'lixo', value: 'nao numero' }, { id: 'zero', value: 0 }, { id: '4321', value: 135 }],
      nomesAceitos: ['DW'], hoje: HOJE,
    });
    expect(r.faturaId).toBe('4321');
  });

  test('valor em texto com vírgula continua sendo lido', () => {
    const r = conferirComprovante({ leitura: { ...LEITURA, valor: '135,00' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE });
    expect(r.valorConfere).toBe(true);
    expect(r.valor).toBe(135);
  });
});

// Fix round 1, achado 3: "DW" como substring aceitava qualquer favorecido que
// contivesse essas duas letras. Nome de até 3 letras passa a casar por palavra
// inteira; nome maior (outro nome aceito da empresa) segue por substring.
describe('fix round 1: nome curto casa por palavra inteira', () => {
  const favorecidoConfere = (favorecido, nomesAceitos) => conferirComprovante({
    leitura: { ...LEITURA, favorecido }, faturas: FATURAS, nomesAceitos, hoje: HOJE,
  }).favorecidoConfere;

  test('EDWARD SILVA ME não é a DW', () => {
    expect(favorecidoConfere('EDWARD SILVA ME', ['DW'])).toBe(false);
  });

  test('DW como palavra inteira confere, no começo ou no fim', () => {
    expect(favorecidoConfere('DW TELECOM LTDA', ['DW'])).toBe(true);
    expect(favorecidoConfere('Pix para DW', ['DW'])).toBe(true);
  });

  test('DWTELECOM não casa com DW, mas casa com o nome cadastrado inteiro', () => {
    expect(favorecidoConfere('DWTELECOM', ['DW'])).toBe(false);
    expect(favorecidoConfere('DWTELECOM', ['DW', 'DWTELECOM'])).toBe(true);
  });

  test('nome longo do recebedor continua casando por substring', () => {
    expect(favorecidoConfere('PAGAMENTO A DW TELECOM LTDA ME', ['DW Telecom Ltda'])).toBe(true);
  });
});
