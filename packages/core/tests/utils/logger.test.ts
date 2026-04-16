import { describe, expect, it } from '@rstest/core';
import { getForceColorEnv } from '../../src/utils/logger';

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
