import { join } from 'node:path';
import { expect, it } from '@rstest/core';

const customImport = async (name: string) => {
  return import(join(__dirname, name));
};

it('should load runtime deps correctly', async () => {
  const res = await customImport('./a.js');
  expect(res.a).toBe(1);
});

it('should load compile-time deps correctly', async () => {
  const res = await import('./b.ts');
  expect(res.b).toBe(1);
});
