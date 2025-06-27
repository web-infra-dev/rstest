import { afterAll, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs.length).toBe(3);
});

it.only.each([
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
])('%i + %i should be %i', (a, b, expected) => {
  expect(a + b).toBe(expected);
  logs.push('executed');
});

it('will not be run', () => {
  expect(1 + 1).toBe(1);
  logs.push('executed');
});
