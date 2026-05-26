import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
// @ts-expect-error: plain .js module, no declaration file needed
import {
  resolveHelper,
  resolveWithPaths,
} from './require-resolve-origin/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const customPath = join(__dirname, 'require-resolve-origin/custom-path');
const packageDir = join(
  customPath,
  'node_modules/rstest-require-resolve-target',
);

mkdirSync(packageDir, { recursive: true });
writeFileSync(
  join(packageDir, 'package.json'),
  JSON.stringify({ main: 'index.js', name: 'rstest-require-resolve-target' }),
);
writeFileSync(join(packageDir, 'index.js'), "module.exports = 'target';");

it('should resolve require.resolve relative to the source module', () => {
  expect(resolveHelper()).toMatch(
    /[\\/]require-resolve-origin[\\/]exportHelper\.js$/,
  );
});

it('should preserve require.resolve paths option with injected origin', () => {
  expect(resolveWithPaths(customPath)).toMatch(
    /[\\/]custom-path[\\/]node_modules[\\/]rstest-require-resolve-target[\\/]index\.js$/,
  );
});
