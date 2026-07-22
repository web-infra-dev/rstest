import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@rstest/core';

const require = createRequire(import.meta.url);

test('createRequire loads a cjs-style .ts at runtime in a type module scope', () => {
  expect(require('./plugin.ts')).toEqual({ name: 'cjs-plugin' });
});

test('dynamic import of a cjs-style .ts at runtime in a type module scope', async () => {
  // The path lives in a variable so Rspack cannot bundle it: the import falls
  // through to a native `import()` and reaches the load hook.
  const pluginPath = pathToFileURL(join(import.meta.dirname, 'plugin.ts')).href;
  const mod = await import(pluginPath);

  expect((mod.default ?? mod).name).toBe('cjs-plugin');
});
