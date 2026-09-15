const { motivoDaMeta, motivoDaResposta } = require('./meta-error');

describe('motivoDaMeta', () => {
  test('returns null when there is no error object', () => {
    expect(motivoDaMeta(null)).toBeNull();
    expect(motivoDaMeta(undefined)).toBeNull();
  });

  test('prefers error_user_msg when present', () => {
    const error = {
      code: 131049,
      title: 'Something',
      message: 'raw',
      error_user_msg: 'A Meta limitou marketing para este número.',
      error_data: { details: 'engagement too low' },
    };
    expect(motivoDaMeta(error)).toBe('(131049) A Meta limitou marketing para este número.');
  });

  test('falls back to error_data.details when there is no error_user_msg', () => {
    const error = { code: 131047, error_data: { details: 'Re-engagement message' } };
    expect(motivoDaMeta(error)).toBe('(131047) Re-engagement message');
  });

  test('falls back to title, then message, in that order', () => {
    expect(motivoDaMeta({ code: 100, title: 'Invalid parameter', message: 'generic' })).toBe('(100) Invalid parameter');
    expect(motivoDaMeta({ code: 100, message: 'Generic error' })).toBe('(100) Generic error');
  });

  test('omits the "(code)" prefix when code is missing', () => {
    expect(motivoDaMeta({ title: 'Sem código' })).toBe('Sem código');
  });

  test('returns null when no usable text piece is present, even with a code', () => {
    expect(motivoDaMeta({ code: 131049 })).toBeNull();
  });
});

describe('motivoDaResposta', () => {
  test('returns null when there is no data at all', () => {
    expect(motivoDaResposta(null)).toBeNull();
    expect(motivoDaResposta(undefined)).toBeNull();
  });

  test('delegates to motivoDaMeta when data.error is a Meta-shaped object', () => {
    const data = { error: { code: 131049, error_user_msg: 'A Meta limitou marketing.' } };
    expect(motivoDaResposta(data)).toBe('(131049) A Meta limitou marketing.');
  });

  test('reads the 360dialog shape ({ meta: { http_code, developer_message } }) when there is no error object', () => {
    const data = { meta: { success: false, http_code: 403, developer_message: 'Access to this API is forbidden' } };
    expect(motivoDaResposta(data)).toBe('(403) Access to this API is forbidden');
  });

  test('omits the "(code)" prefix when the 360dialog body has no http_code', () => {
    const data = { meta: { success: false, developer_message: 'Forbidden' } };
    expect(motivoDaResposta(data)).toBe('Forbidden');
  });

  test('reads the 360dialog plain-string error shape ({ error: "..." })', () => {
    const data = { error: 'This number is blocked due to lack of payment on client side.' };
    expect(motivoDaResposta(data)).toBe('This number is blocked due to lack of payment on client side.');
  });

  test('falls back to a plain string body, trimmed to 300 chars', () => {
    expect(motivoDaResposta('  plain text error  ')).toBe('plain text error');
    expect(motivoDaResposta('x'.repeat(400))).toBe('x'.repeat(300));
  });

  test('returns null for an empty string body', () => {
    expect(motivoDaResposta('')).toBeNull();
    expect(motivoDaResposta('   ')).toBeNull();
  });

  test('returns null when nothing usable is present', () => {
    expect(motivoDaResposta({})).toBeNull();
    expect(motivoDaResposta({ meta: { success: false } })).toBeNull();
  });
});
