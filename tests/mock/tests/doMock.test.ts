import { expect, rs, test } from '@rstest/core';

test('doMock works', async () => {
  const { increment: incrementWith1 } = await import('../src/increment');
  expect(incrementWith1(1)).toBe(2);

  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 10,
  }));

  const { increment: incrementWith10 } = await import('../src/increment');
  expect(incrementWith10(1)).toBe(11);
});

test('the second doMock can override the first doMock', async () => {
  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 10,
  }));

  const { increment: incrementWith1 } = await import('../src/increment');

  expect(incrementWith1(1)).toBe(11);

  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 20,
  }));

  const { increment: incrementWith20 } = await import('../src/increment');

  expect(incrementWith20(1)).toBe(21);
});

test('the third doMock can override the second doMock', async () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  rs.doMock('../src/increment', async () => {
    await sleep(500);
    return {
      increment: (num: number) => num + 100,
    };
  });

  const { increment: incrementWith1 } = await import('../src/increment');

  expect(incrementWith1(1)).toBe(101);

  rs.doMock('../src/increment', async () => {
    await sleep(500);
    return {
      increment: (num: number) => num + 200,
    };
  });

  const { increment: incrementWith20 } = await import('../src/increment');

  expect(incrementWith20(1)).toBe(201);
});
