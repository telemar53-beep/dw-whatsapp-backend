const { validateQuickReplyButtons, isValidTemplateName, extractVariableCount, substituteVariables } = require('./template-validator');

describe('isValidTemplateName', () => {
  test('accepts lowercase letters, digits, and underscores', () => {
    expect(isValidTemplateName('fatura_vencida_2')).toBe(true);
  });

  test('rejects uppercase letters', () => {
    expect(isValidTemplateName('FaturaVencida')).toBe(false);
  });

  test('rejects spaces and hyphens', () => {
    expect(isValidTemplateName('fatura vencida')).toBe(false);
    expect(isValidTemplateName('fatura-vencida')).toBe(false);
  });

  test('rejects a non-string value', () => {
    expect(isValidTemplateName(null)).toBe(false);
    expect(isValidTemplateName(undefined)).toBe(false);
  });
});

describe('extractVariableCount', () => {
  test('returns 0 for a body with no variables', () => {
    expect(extractVariableCount('Sua fatura está disponível.')).toBe(0);
  });

  test('counts sequential variables starting at {{1}}', () => {
    expect(extractVariableCount('Olá {{1}}, sua fatura de {{2}} venceu em {{3}}.')).toBe(3);
  });

  test('deduplicates a variable that repeats in the body', () => {
    expect(extractVariableCount('Olá {{1}}, {{1}} sua fatura venceu.')).toBe(1);
  });

  test('throws when variables have a gap', () => {
    expect(() => extractVariableCount('Olá {{1}}, veja {{3}}.')).toThrow(
      'Template variables must be sequential starting at {{1}} with no gaps'
    );
  });

  test('throws when the first variable is not {{1}}', () => {
    expect(() => extractVariableCount('Veja {{2}}.')).toThrow(
      'Template variables must be sequential starting at {{1}} with no gaps'
    );
  });
});

describe('substituteVariables', () => {
  test('replaces each placeholder with its matching value', () => {
    const result = substituteVariables('Olá {{1}}, sua fatura de {{2}} venceu.', ['João', 'R$150,00']);
    expect(result).toBe('Olá João, sua fatura de R$150,00 venceu.');
  });

  test('replaces a repeated placeholder with the same value every time it appears', () => {
    const result = substituteVariables('{{1}}, {{1}}!', ['Oi']);
    expect(result).toBe('Oi, Oi!');
  });

  test('leaves the placeholder untouched when no matching value was given', () => {
    const result = substituteVariables('Olá {{1}}.', []);
    expect(result).toBe('Olá {{1}}.');
  });

  test('returns the body unchanged when it has no placeholders', () => {
    expect(substituteVariables('Sem variáveis aqui.', [])).toBe('Sem variáveis aqui.');
  });
});

// Botao de resposta rapida e o unico jeito sancionado pela Meta de o cliente
// reabrir a janela de 24 h com um toque. As regras abaixo sao da Meta: o que
// nao respeita vira REJECTED horas depois, sem explicacao util na tela.
describe('validateQuickReplyButtons', () => {
  test('aceita ate tres botoes', () => {
    expect(() => validateQuickReplyButtons(['Sim', 'Nao', 'Falar com atendente'])).not.toThrow();
  });

  test('aceita nenhum botao', () => {
    expect(() => validateQuickReplyButtons([])).not.toThrow();
    expect(() => validateQuickReplyButtons(undefined)).not.toThrow();
  });

  test('recusa mais de tres botoes', () => {
    expect(() => validateQuickReplyButtons(['a', 'b', 'c', 'd'])).toThrow(/no maximo 3/i);
  });

  test('recusa botao vazio', () => {
    expect(() => validateQuickReplyButtons(['Sim', '  '])).toThrow(/texto/i);
  });

  test('recusa texto acima de 25 caracteres', () => {
    expect(() => validateQuickReplyButtons(['x'.repeat(26)])).toThrow(/25/);
  });

  test('recusa botoes repetidos', () => {
    expect(() => validateQuickReplyButtons(['Sim', 'sim'])).toThrow(/repetid/i);
  });

  // Variavel em botao de resposta rapida nao existe: o texto e fixo.
  test('recusa variavel no texto do botao', () => {
    expect(() => validateQuickReplyButtons(['Ola {{1}}'])).toThrow(/vari/i);
  });
});
