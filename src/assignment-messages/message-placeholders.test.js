const { greetingForNow, firstNameOf, substituteAssignmentPlaceholders } = require('./message-placeholders');

describe('greetingForNow', () => {
  test('returns Bom dia at the start of the morning window (00:00)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 0, 0))).toBe('Bom dia');
  });

  test('returns Bom dia at the end of the morning window (11:59)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 11, 59))).toBe('Bom dia');
  });

  test('returns Boa tarde at the start of the afternoon window (12:00)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 12, 0))).toBe('Boa tarde');
  });

  test('returns Boa tarde at the end of the afternoon window (17:59)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 17, 59))).toBe('Boa tarde');
  });

  test('returns Boa noite at the start of the evening window (18:00)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 18, 0))).toBe('Boa noite');
  });

  test('returns Boa noite at the end of the evening window (23:59)', () => {
    expect(greetingForNow(new Date(2026, 0, 1, 23, 59))).toBe('Boa noite');
  });
});

describe('firstNameOf', () => {
  test('returns the whole name when it is a single word', () => {
    expect(firstNameOf('Geovanna')).toBe('Geovanna');
  });

  test('returns only the first word of a multi-word name', () => {
    expect(firstNameOf('Geovanna Silva Santos')).toBe('Geovanna');
  });

  test('trims and collapses extra whitespace before splitting', () => {
    expect(firstNameOf('  Geovanna   Silva  ')).toBe('Geovanna');
  });
});

describe('substituteAssignmentPlaceholders', () => {
  test('replaces the greeting, agent name and protocol number with the right values', () => {
    const fixedMorning = new Date(2026, 0, 1, 9, 0);
    jest.spyOn(global, 'Date').mockImplementation(() => fixedMorning);
    const template = '@chat_saudacao_maiusculo, meu nome é @chat_atendente. O protocolo do seu atendimento é @chat_protocolo';
    const result = substituteAssignmentPlaceholders(template, {
      agentName: 'Geovanna Silva',
      protocolNumber: 1042,
    });
    global.Date.mockRestore();
    expect(result).toBe('Bom dia, meu nome é Geovanna. O protocolo do seu atendimento é 1042');
  });

  test('leaves text without placeholders unchanged', () => {
    expect(substituteAssignmentPlaceholders('Mensagem fixa sem tokens', { agentName: 'Ana', protocolNumber: 7 })).toBe(
      'Mensagem fixa sem tokens'
    );
  });

  test('replaces a repeated placeholder every time it appears', () => {
    const fixedEvening = new Date(2026, 0, 1, 20, 0);
    jest.spyOn(global, 'Date').mockImplementation(() => fixedEvening);
    const result = substituteAssignmentPlaceholders('@chat_protocolo - @chat_protocolo', { agentName: 'Ana', protocolNumber: 5 });
    global.Date.mockRestore();
    expect(result).toBe('5 - 5');
  });
});
