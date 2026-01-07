import { expect, test } from '@rstest/core';

test('can import app code that uses federated module specifiers', async () => {
  const mod = await import('./App.jsx');
  expect(typeof mod.default).toBe('function');
});
