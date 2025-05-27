import { expect, rs, test } from '@rstest/core';

test('reset modules works', async () => {
  const mod1 = await import('../src/b');
  rs.resetModules();
  const mod2 = await import('../src/b');
  const mod3 = await import('../src/b');
  expect(mod1).not.toBe(mod2);
  expect(mod2).toBe(mod3);
});
