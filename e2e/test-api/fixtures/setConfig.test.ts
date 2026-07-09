import { describe, expect, it, rs } from '@rstest/core';
import { sleep } from '../../scripts';

rs.setConfig({
  testTimeout: 100,
});

describe('level A', () => {
  it('it in level A', async () => {
    expect(1 + 1).toBe(3);
  });
});

it('it in level B', async () => {
  await sleep(150);
  expect(1 + 1).toBe(2);
});

it('it in level C', async () => {
  const config = rs.getConfig();

  expect(config.testTimeout).toBe(100);
});
