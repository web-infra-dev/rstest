import { expect, rs, test } from '@rstest/core';

rs.doMock('../src/increment', () => ({
  increment: (num: number) => num + 10,
}));

test('reset modules works', async () => {
  const { increment: incrementWith10 } = await import('../src/increment');
  expect(incrementWith10(1)).toBe(11);
  const mod1 = await import('../src/b');
  rs.resetModules();
  const mod2 = await import('../src/b');
  const mod3 = await import('../src/b');
  expect(mod1).not.toBe(mod2);
  expect(mod2).toBe(mod3);
  // resetModules should not reset mocks registry.
  const { increment: incrementStillWith10 } = await import('../src/increment');
  expect(incrementStillWith10(1)).toBe(11);
});
