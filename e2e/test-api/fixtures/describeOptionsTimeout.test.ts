import { describe, it } from '@rstest/core';
import { sleep } from '../../scripts';

// A `timeout` set on `describe` propagates to inner tests as a default; a
// per-test `timeout` still overrides it.
describe('suite timeout propagates', { timeout: 50 }, () => {
  it('inner test inherits the suite timeout', async ({ expect }) => {
    await sleep(100);
    expect(1 + 1).toBe(2);
  });

  it(
    'per-test timeout overrides the suite timeout',
    { timeout: 200 },
    async ({ expect }) => {
      await sleep(100);
      expect(1 + 1).toBe(2);
    },
  );
});
