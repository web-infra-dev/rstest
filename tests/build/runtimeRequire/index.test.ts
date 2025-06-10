import { join } from 'node:path';
import { expect, it } from '@rstest/core';

const customRequire = (name: string) => {
  return require(join(__dirname, name));
};

it('should load runtime deps correctly', async () => {
  const res = require('./a.js');
  expect(res.a).toBe(1);
});

it('should load compile-time deps correctly', async () => {
  const res = customRequire('./b.ts');
  expect(res.b).toBe(1);
});
