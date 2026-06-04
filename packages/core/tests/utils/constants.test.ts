import { describe, expect, it } from '@rstest/core';
import { RSTEST_ENV_SYMBOL_KEY } from '../../src/utils/constants';

describe('RSTEST_ENV_SYMBOL_KEY', () => {
  // The core worker runtime, the browser client, and the host build-define text
  // all resolve Symbol.for(RSTEST_ENV_SYMBOL_KEY). The cross-context env store
  // only works if every context uses this exact description string — pin the
  // value so a rename cannot silently break env propagation.
  it('is the exact well-known env symbol description', () => {
    expect(RSTEST_ENV_SYMBOL_KEY).toBe('rstest.env');
  });

  it('resolves to the same global-registry symbol as the literal', () => {
    expect(Symbol.for(RSTEST_ENV_SYMBOL_KEY)).toBe(Symbol.for('rstest.env'));
  });

  it('reproduces the exact double-quoted host define text via JSON.stringify', () => {
    expect(
      `globalThis[Symbol.for(${JSON.stringify(RSTEST_ENV_SYMBOL_KEY)})]`,
    ).toBe('globalThis[Symbol.for("rstest.env")]');
  });
});
