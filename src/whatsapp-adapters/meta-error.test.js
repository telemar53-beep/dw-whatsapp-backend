const { motivoDaMeta } = require('./meta-error');

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
