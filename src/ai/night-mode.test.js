const { dentroDaJanela, isNightModeActive } = require('./night-mode');

// Instantes em horário de São Paulo (UTC-3).
const as = (hhmm) => new Date(`2026-09-13T${hhmm}:00-03:00`);
const CANAL = { aiEnabled: true, aiTriageEnabled: true, aiNightModeEnabled: true };
const CONFIG = { nightStartTime: '20:00', nightEndTime: '08:00' };

describe('dentroDaJanela', () => {
  test('janela que atravessa a meia-noite', () => {
    expect(dentroDaJanela(as('20:00'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('23:59'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('00:10'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('07:59'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('08:00'), '20:00', '08:00')).toBe(false);
    expect(dentroDaJanela(as('12:00'), '20:00', '08:00')).toBe(false);
    expect(dentroDaJanela(as('19:59'), '20:00', '08:00')).toBe(false);
  });
  test('janela no mesmo dia, e janela vazia nunca ativa', () => {
    expect(dentroDaJanela(as('13:00'), '12:00', '14:00')).toBe(true);
    expect(dentroDaJanela(as('14:00'), '12:00', '14:00')).toBe(false);
    expect(dentroDaJanela(as('13:00'), '13:00', '13:00')).toBe(false);
    expect(dentroDaJanela(as('13:00'), null, '14:00')).toBe(false);
  });
  test('usa o fuso de São Paulo, não o do servidor', () => {
    // 02:30 UTC = 23:30 em São Paulo (dentro de 20:00–08:00).
    expect(dentroDaJanela(new Date('2026-09-14T02:30:00Z'), '20:00', '08:00')).toBe(true);
  });
});

describe('isNightModeActive', () => {
  test('exige as três flags do canal, a janela configurada e a hora dentro dela', () => {
    expect(isNightModeActive({ channel: CANAL, config: CONFIG, agora: as('22:00') })).toBe(true);
    expect(isNightModeActive({ channel: { ...CANAL, aiNightModeEnabled: false }, config: CONFIG, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: { ...CANAL, aiTriageEnabled: false }, config: CONFIG, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: { ...CANAL, aiEnabled: false }, config: CONFIG, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: CANAL, config: { nightStartTime: null, nightEndTime: null }, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: CANAL, config: CONFIG, agora: as('10:00') })).toBe(false);
    expect(isNightModeActive({ channel: null, config: CONFIG, agora: as('22:00') })).toBe(false);
  });
});
