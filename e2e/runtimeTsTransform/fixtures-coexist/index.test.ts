import { createRequire } from 'node:module';
import { expect, test } from '@rstest/core';

const require = createRequire(import.meta.url);

// Verified on Node v22.22.3: once a third party assigns `Module._extensions['.ts']`,
// Node's CJS loader gives it precedence and rstest's sync load hook never fires
// on the `require()` path at all. The third-party loader wins outright.
test('a third-party .ts extension keeps ownership of the require path', () => {
  const plugin = require('./plugin.ts');

  expect(plugin.__loadedBy).toBe('third-party-ts-extension');
  expect(plugin.name).toBe('cjs-plugin');
});
