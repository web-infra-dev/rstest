import { describe, expect, it } from '@rstest/core';
import { sleep } from '../../scripts';

describe('level A', () => {
  it('it in level A', async () => {
    await sleep(100);
    expect(1 + 1).toBe(2);
  }, 50);

  it('it in level B', async () => {
    await sleep(6000);
    expect(1 + 1).toBe(2);
  });
});
