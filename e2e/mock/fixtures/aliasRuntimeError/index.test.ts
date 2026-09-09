import { expect, rstest as vi, test } from '@rstest/core';
import { increment } from '../../src/increment';

vi.mock('../../src/increment', () => ({
  increment: (num: number) => num + 10,
}));

test('alias mock should not be silent', () => {
  expect(increment(1)).toBe(11);
});
