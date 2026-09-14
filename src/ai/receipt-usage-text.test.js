const { descreverUsoAnterior } = require('./receipt-usage-text');

describe('descreverUsoAnterior', () => {
  // O fuso é o da operação: um uso às 23:12 de São Paulo não pode virar 02:12
  // do dia seguinte só porque o servidor roda em UTC.
  test('descreve contrato, dia e hora no fuso de São Paulo', () => {
    const uso = { contactId: 'ct-1', contractId: 26515, usedAt: new Date('2026-09-14T02:12:00.000Z') };
    expect(descreverUsoAnterior(uso)).toBe('já utilizado no contrato 26515 em 13/09 às 23:12');
  });

  test('aceita a data como texto ISO', () => {
    const uso = { contactId: null, contractId: 17402, usedAt: '2026-09-13T15:00:00.000Z' };
    expect(descreverUsoAnterior(uso)).toBe('já utilizado no contrato 17402 em 13/09 às 12:00');
  });

  // Meia-noite em São Paulo é 03:00 UTC: sem hour12 false o Intl escreveria
  // "24:00" (o bug de locale que já pegamos no protocolo diário).
  test('meia-noite sai como 00:00, não 24:00', () => {
    const uso = { contractId: 1, usedAt: new Date('2026-09-13T03:00:00.000Z') };
    expect(descreverUsoAnterior(uso)).toBe('já utilizado no contrato 1 em 13/09 às 00:00');
  });

  test('sem contrato, a frase não inventa um', () => {
    const uso = { contactId: 'ct-1', contractId: null, usedAt: new Date('2026-09-14T02:12:00.000Z') };
    expect(descreverUsoAnterior(uso)).toBe('já utilizado em 13/09 às 23:12');
  });

  test('sem usedAt utilizável, sobra só o fato', () => {
    expect(descreverUsoAnterior({ contractId: 26515, usedAt: null })).toBe('já utilizado');
    expect(descreverUsoAnterior({ contractId: 26515, usedAt: 'não é data' })).toBe('já utilizado');
    expect(descreverUsoAnterior({ contractId: null, usedAt: undefined })).toBe('já utilizado');
  });

  // Nunca chamada sem uso, mas a função é usada dentro da montagem de texto de
  // uma recusa: um null aqui não pode derrubar a resposta ao cliente.
  test('sem uso nenhum devolve string vazia', () => {
    expect(descreverUsoAnterior(null)).toBe('');
    expect(descreverUsoAnterior(undefined)).toBe('');
  });
});
