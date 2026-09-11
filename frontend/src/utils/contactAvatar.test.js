import { describe, test, expect } from 'vitest';
import { applyContactAvatarUpdate } from './contactAvatar';

describe('applyContactAvatarUpdate', () => {
  const list = [
    { id: 'c1', contactId: 'ct1', contactAvatarPath: 'old.jpg' },
    { id: 'c2', contactId: 'ct2', contactAvatarPath: null },
    { id: 'c3', contactId: 'ct1', contactAvatarPath: 'old.jpg' },
  ];

  test('updates every conversation of the contact and leaves the others untouched', () => {
    const next = applyContactAvatarUpdate(list, { contactId: 'ct1', avatarPath: 'new.jpg' });
    expect(next).toEqual([
      { id: 'c1', contactId: 'ct1', contactAvatarPath: 'new.jpg' },
      { id: 'c2', contactId: 'ct2', contactAvatarPath: null },
      { id: 'c3', contactId: 'ct1', contactAvatarPath: 'new.jpg' },
    ]);
    expect(next[1]).toBe(list[1]);
  });

  test('clears the avatar when the payload carries null', () => {
    const next = applyContactAvatarUpdate(list, { contactId: 'ct1', avatarPath: null });
    expect(next[0].contactAvatarPath).toBeNull();
  });

  test('returns the same array when nothing changes', () => {
    expect(applyContactAvatarUpdate(list, { contactId: 'ct-unknown', avatarPath: 'x.jpg' })).toBe(list);
    expect(applyContactAvatarUpdate(list, { contactId: 'ct1', avatarPath: 'old.jpg' })).toBe(list);
    expect(applyContactAvatarUpdate(list, {})).toBe(list);
  });
});
