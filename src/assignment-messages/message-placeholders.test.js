const { greetingForNow, firstNameOf, substituteAssignmentPlaceholders } = require('./message-placeholders');

// As bordas sao instantes UTC explicitos, e nao `new Date(ano, mes, dia, hora)`:
// aquele construtor usa a hora LOCAL da maquina, entao os testes passavam aqui
// (fuso de Sao Paulo) e quebrariam num servidor em UTC — que e exatamente onde
// o bug vivia. Sao Paulo e UTC-3, sem horario de verao desde 2019.
describe('greetingForNow', () => {
  test('Bom dia no comeco da manha (00:00 em Sao Paulo)', () => {
    expect(greetingForNow(new Date('2026-01-01T03:00:00Z'))).toBe('Bom dia');
  });

  test('Bom dia no fim da manha (11:59 em Sao Paulo)', () => {
    expect(greetingForNow(new Date('2026-01-01T14:59:00Z'))).toBe('Bom dia');
  });

  test('Boa tarde no comeco da tarde (12:00 em Sao Paulo)', () => {
    expect(greetingForNow(new Date('2026-01-01T15:00:00Z'))).toBe('Boa tarde');
  });

  test('Boa tarde no fim da tarde (17:59 em Sao Paulo)', () => {
    expect(greetingForNow(new Date('2026-01-01T20:59:00Z'))).toBe('Boa tarde');
  });

  test('Boa noite no comeco da noite (18:00 em Sao Paulo)', () => {
    expect(greetingForNow(new Date('2026-01-01T21:00:00Z'))).toBe('Boa noite');
  });

  test('Boa noite no fim da noite (23:59 em Sao Paulo)', () => {
    expect(greetingForNow(new Date('2026-01-02T02:59:00Z'))).toBe('Boa noite');
  });
});

// O bug que o dono viu em 2026-09-17: mensagem de abertura enviada de manha
// chegava com "Boa tarde". O Render roda em UTC e a saudacao lia a hora local
// do servidor, entao 9h em Sao Paulo virava 12h e passava do meio-dia.
describe('greetingForNow com o servidor fora do fuso de Sao Paulo', () => {
  const tzOriginal = process.env.TZ;

  afterEach(() => {
    process.env.TZ = tzOriginal;
  });

  test('servidor em UTC: 9h30 da manha em Sao Paulo ainda e Bom dia', () => {
    process.env.TZ = 'UTC';
    expect(greetingForNow(new Date('2026-09-17T12:30:00Z'))).toBe('Bom dia');
  });

  test('servidor em UTC: 21h em Sao Paulo e Boa noite, nao o dia seguinte', () => {
    process.env.TZ = 'UTC';
    expect(greetingForNow(new Date('2026-09-18T00:00:00Z'))).toBe('Boa noite');
  });

  test('servidor em Toquio: vale a hora de Sao Paulo, nao a de la', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(greetingForNow(new Date('2026-09-17T12:30:00Z'))).toBe('Bom dia');
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
      protocolNumber: '20260911-0001',
    });
    global.Date.mockRestore();
    expect(result).toBe('Bom dia, meu nome é Geovanna. O protocolo do seu atendimento é 20260911-0001');
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
