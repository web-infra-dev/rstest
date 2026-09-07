import { describe, expect, it } from '@rstest/core';
import {
  getForceColorEnv,
  hasUserColorEnv,
  pickColorEnv,
  resolveTaskColorEnv,
} from '../../src/utils/logger';

describe('hasUserColorEnv', () => {
  it('detects defined FORCE_COLOR and NO_COLOR values', () => {
    expect(hasUserColorEnv({})).toBe(false);
    expect(hasUserColorEnv({ FORCE_COLOR: '' })).toBe(true);
    expect(hasUserColorEnv({ NO_COLOR: '1' })).toBe(true);
  });
});

describe('pickColorEnv', () => {
  it('keeps only defined color env values', () => {
    expect(
      pickColorEnv({ FORCE_COLOR: '1', NO_COLOR: '', OTHER_ENV: 'value' }),
    ).toEqual({ FORCE_COLOR: '1', NO_COLOR: '' });
    expect(
      pickColorEnv({
        FORCE_COLOR: undefined,
        NO_COLOR: undefined,
        OTHER_ENV: 'value',
      }),
    ).toEqual({});
  });
});

describe('getForceColorEnv', () => {
  it('disables colors for agent environments without user overrides', () => {
    expect(
      getForceColorEnv({
        userSetColorEnv: false,
        isAgent: true,
        isColorSupported: true,
      }),
    ).toEqual({ NO_COLOR: '1', FORCE_COLOR: '0' });
  });

  it('preserves user color env in agent environments', () => {
    expect(
      getForceColorEnv({
        userSetColorEnv: true,
        isAgent: true,
        isColorSupported: true,
      }),
    ).toEqual({});
  });

  it('propagates color support to workers when users did not override it', () => {
    expect(
      getForceColorEnv({
        userSetColorEnv: false,
        isAgent: false,
        isColorSupported: true,
      }),
    ).toEqual({ FORCE_COLOR: '1' });
  });

  it('keeps colors disabled when the parent process does not support them', () => {
    expect(
      getForceColorEnv({
        userSetColorEnv: false,
        isAgent: false,
        isColorSupported: false,
      }),
    ).toEqual({});
  });

  it('preserves user color env in non-agent environments', () => {
    expect(
      getForceColorEnv({
        userSetColorEnv: true,
        isAgent: false,
        isColorSupported: true,
      }),
    ).toEqual({});
  });
});

describe('resolveTaskColorEnv', () => {
  it('preserves a user color override after the task env merge', () => {
    const resolvedEnv = { NO_COLOR: '1' } as const;

    expect({
      ...resolveTaskColorEnv(resolvedEnv, {
        isAgent: false,
        isColorSupported: true,
      }),
      ...resolvedEnv,
    }).toEqual({ FORCE_COLOR: undefined, NO_COLOR: '1' });
  });

  it('states both color keys when applying the default', () => {
    expect(
      resolveTaskColorEnv({}, { isAgent: false, isColorSupported: true }),
    ).toEqual({ FORCE_COLOR: '1', NO_COLOR: undefined });
  });
});
