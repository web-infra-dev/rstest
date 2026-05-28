import { describe, it } from '@rstest/core';
import { sleep } from '../../scripts';

describe('timeout shorthand vs options', () => {
  it('numeric shorthand still trips on slow body', async ({ expect }) => {
    await sleep(100);
    expect(1 + 1).toBe(2);
  }, 50);

  it(
    'options.timeout trips on slow body',
    async ({ expect }) => {
      await sleep(100);
      expect(1 + 1).toBe(2);
    },
    { timeout: 50 },
  );
});
