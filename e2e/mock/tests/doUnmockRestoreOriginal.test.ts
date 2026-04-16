import { afterEach, expect, rs, test } from '@rstest/core';

afterEach(() => {
  rs.doUnmock('../src/increment');
  rs.resetModules();
});

test('doUnmock should restore original after multiple doMock calls', async () => {
  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 100,
  }));

  const { increment: firstIncrement } = await import('../src/increment');
  expect(firstIncrement(1)).toBe(101);

  rs.resetModules();

  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 200,
  }));

  const { increment: secondIncrement } = await import('../src/increment');
  expect(secondIncrement(1)).toBe(201);

  rs.doUnmock('../src/increment');
  rs.resetModules();

  const { increment } = await import('../src/increment');
  expect(increment(1)).toBe(2);
});
