import { describe, expect, it, test } from '@rstest/core';
import { sleep } from '../../scripts';

describe('level A', () => {
  test('it in level A', async () => {
    await sleep(100);
    expect(1 + 1).toBe(2);
  }, 50);

  it('it in level B', async () => {
    await sleep(5100);
    expect(1 + 1).toBe(2);
  });
});
