import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@rstest/core';

const require = createRequire(import.meta.url);

test('runs node register hooks inside test workers', async () => {
  expect(existsSync(process.env.RUNTIME_REGISTER_FLAG_PATH!)).toBe(true);

  const cjsModule = require(`${process.cwd()}/runtime-cjs.ts`);
  expect(cjsModule.runtimeValue).toBe('loaded by cjs require hook');

  const moduleUrl = pathToFileURL(`${process.cwd()}/runtime-module.ts`).href;
  const imported = await import(moduleUrl);
  expect(imported.runtimeValue).toBe('loaded by node register');
});
