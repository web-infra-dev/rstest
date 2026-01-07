import { expect, test } from '@rstest/core';

test('can import app code that uses federated module specifiers', async () => {
  // This import transitively loads federated imports:
  // - component-app/Button, Dialog, ToolTip
  // With Module Federation configured in `rstest.config.ts` and dev servers running,
  // this should load naturally (no mocks).
  const mod = await import('./App.jsx');
  expect(typeof mod.default).toBe('function');
});
