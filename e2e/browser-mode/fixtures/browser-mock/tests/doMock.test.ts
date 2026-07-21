import { expect, it, rs } from '@rstest/core';

it('doMock affects later dynamic imports and doUnmock restores the original', async () => {
  const { increment } = await import('../src/increment');
  expect(increment(1)).toBe(2);

  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 10,
  }));
  const { increment: incrementWith10 } = await import('../src/increment');
  expect(incrementWith10(1)).toBe(11);

  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 20,
  }));
  const { increment: incrementWith20 } = await import('../src/increment');
  expect(incrementWith20(1)).toBe(21);

  rs.doUnmock('../src/increment');
  const { increment: restored } = await import('../src/increment');
  expect(restored(1)).toBe(2);
});
