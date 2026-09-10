import { describe, test, expect } from 'vitest';
import { OFFICIAL_CHANNEL_TYPES, isOfficialChannelType, channelTypeLabel } from './channelTypes';

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

describe('channelTypeLabel', () => {
  test('labels meta_cloud as an official channel', () => {
    expect(channelTypeLabel('meta_cloud')).toBe('Meta Cloud (oficial)');
  });

  test('labels 360dialog as an official channel', () => {
    expect(channelTypeLabel('360dialog')).toBe('360dialog (oficial)');
  });

  test('labels baileys as an unofficial channel', () => {
    expect(channelTypeLabel('baileys')).toBe('Baileys (não oficial)');
  });

  test('falls back to the raw type for an unknown type', () => {
    expect(channelTypeLabel('sms')).toBe('sms');
  });
});
