import { describe, expect, it } from '@rstest/core';
import { formatUser } from '../src/profile';

describe('user profile', () => {
  it('formats display names', () => {
    const profile = formatUser('Ada Lovelace', 'admin');

    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile.normalized).toBe('ada-lovelace');
  });
});
