import { expect, rs, test } from '@rstest/core';

test('doMock should support async factory with importActual', async () => {
  rs.doMock('../src/increment', async () => {
    const actual =
      await rs.importActual<typeof import('../src/increment')>(
        '../src/increment',
      );

    return {
      ...actual,
      increment: (num: number) => num + 100,
    };
  });

  const { increment } = await import('../src/increment');
  expect(increment(1)).toBe(101);
});
