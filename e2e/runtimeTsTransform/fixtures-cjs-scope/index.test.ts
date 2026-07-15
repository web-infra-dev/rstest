import { createRequire } from 'node:module';
import { expect, test } from '@rstest/core';

const require = createRequire(import.meta.url);

test('createRequire loads an esm-style .ts at runtime in a type commonjs scope', () => {
  expect(require('./esmPlugin.ts').name).toBe('esm-plugin');
});
