import { describe, expect, it } from '@rstest/core';
import { resolveColorEnabled } from '../../src/utils/logger';

describe('resolveColorEnabled', () => {
  it.each([
    {
      name: 'NO_COLOR beats FORCE_COLOR',
      env: { NO_COLOR: '1', FORCE_COLOR: '1' },
      fallback: true,
      expected: false,
    },
    {
      name: 'empty NO_COLOR uses fallback',
      env: { NO_COLOR: '' },
      fallback: true,
      expected: true,
    },
    {
      name: 'FORCE_COLOR=0',
      env: { FORCE_COLOR: '0' },
      fallback: true,
      expected: false,
    },
    {
      name: 'FORCE_COLOR=false',
      env: { FORCE_COLOR: 'false' },
      fallback: true,
      expected: false,
    },
    {
      name: 'empty FORCE_COLOR overrides fallback',
      env: { FORCE_COLOR: '' },
      fallback: false,
      expected: true,
    },
    {
      name: 'no color env uses fallback',
      env: {},
      fallback: false,
      expected: false,
    },
  ])('$name', ({ env, fallback, expected }) => {
    expect(resolveColorEnabled(env, fallback)).toBe(expected);
  });
});
