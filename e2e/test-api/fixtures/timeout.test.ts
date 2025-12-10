import { describe, it } from '@rstest/core';
import { sleep } from '../../scripts';

describe('level A', () => {
  it('it in level A', async ({ expect }) => {
    await sleep(100);
    expect(1 + 1).toBe(2);
  }, 50);

  it('it in level B', async ({ expect }) => {
    expect(1 + 1).toBe(2);
    await sleep(5100);
    expect(1 + 1).toBe(2);
  });
});
