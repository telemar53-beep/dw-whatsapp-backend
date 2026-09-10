const { OFFICIAL_CHANNEL_TYPES, isOfficialChannelType } = require('./channel-types');

describe('isOfficialChannelType', () => {
  test('returns true for meta_cloud', () => {
    expect(isOfficialChannelType('meta_cloud')).toBe(true);
  });

  test('returns true for 360dialog', () => {
    expect(isOfficialChannelType('360dialog')).toBe(true);
  });

  test('returns false for baileys', () => {
    expect(isOfficialChannelType('baileys')).toBe(false);
  });

  test('returns false for an unknown type', () => {
    expect(isOfficialChannelType('unknown')).toBe(false);
  });
});

describe('OFFICIAL_CHANNEL_TYPES', () => {
  test('contains exactly meta_cloud and 360dialog', () => {
    expect(OFFICIAL_CHANNEL_TYPES).toEqual(['meta_cloud', '360dialog']);
  });
});
