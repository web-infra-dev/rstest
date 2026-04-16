import { afterAll, expect, rs, test } from '@rstest/core';

afterAll(() => {
  rs.doUnmock('../src/increment');
});

rs.doMock('../src/increment', () => ({
  increment: (num: number) => num + 10,
}));

rs.doUnmock('../src/b');

test('reset modules works', async () => {
  const { increment: incrementWith10 } = await import('../src/increment');
  expect(incrementWith10(1)).toBe(11);
  const mod1 = await import('../src/testResetModule');
  rs.resetModules();
  const mod2 = await import('../src/testResetModule');
  const mod3 = await import('../src/testResetModule');
  expect(mod1).not.toBe(mod2);
  expect(mod2).toBe(mod3);
  // resetModules should not reset mocks registry.
  const { increment: incrementStillWith10 } = await import('../src/increment');
  expect(incrementStillWith10(1)).toBe(11);
});
