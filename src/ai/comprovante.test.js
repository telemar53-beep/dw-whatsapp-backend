const { conferirComprovante, PROMPT_VISAO } = require('./comprovante');

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

test('data velha (8 dias) ou futura não confere; 7 dias atrás confere', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-09-05' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(false);
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-09-06' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(true);
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-09-14' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(false);
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
