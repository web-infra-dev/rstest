import { expect, it } from '@rstest/core';

it('dynamically imports an in-source test module', async () => {
  expect(import.meta.rstest).toBeDefined();
  const { sayHi } = await import('../src/sayHi');
  expect(sayHi()).toBe('hi');
});
