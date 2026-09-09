import { expect, rs, test } from '@rstest/core';
import * as actual from '../src/increment' with { rstest: 'importActual' };

test('doMock should support sync factory with importActual', async () => {
  rs.doMock('../src/increment', () => {
    return {
      ...actual,
      increment: (num: number) => num + 100,
    };
  });

  const { increment } = await import('../src/increment');
  expect(increment(1)).toBe(101);
});
