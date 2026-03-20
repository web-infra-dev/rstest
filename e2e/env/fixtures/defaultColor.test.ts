import { expect, it } from '@rstest/core';

it('should propagate color env correctly without user overrides', () => {
  // Without user-set FORCE_COLOR/NO_COLOR, getForceColorEnv() decides based
  // on the parent process's color detection (picocolors isColorSupported).
  //
  // Color detected (CI=true, win32, TTY, etc.) → FORCE_COLOR='1' injected.
  // No color detected (piped non-TTY, TERM=dumb, etc.) → nothing injected.
  //
  // NO_COLOR should never appear here — that's only for agent environments.
  expect(process.env.NO_COLOR).toBeUndefined();

  if (process.env.FORCE_COLOR !== undefined) {
    expect(process.env.FORCE_COLOR).toBe('1');
  }
});
