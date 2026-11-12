import { beforeAll, expect, it } from '@rstest/core';

beforeAll(() => {
  throw new Error('beforeAll failed');
});

it('never runs', () => {
  expect(1 + 1).toBe(2);
});
