import { describe, expect, it, rs } from '@rstest/core';
import { sleep } from '../../scripts';

rs.setConfig({
  testTimeout: 50,
});

describe('level A', () => {
  it('it in level A', async () => {
    console.log('aaaa');
    // await sleep(100);
    expect(1 + 1).toBe(3);
  });
});

it('it in level B', async () => {
  await sleep(100);
  expect(1 + 1).toBe(2);
});
