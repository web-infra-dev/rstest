import fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from '@rstest/core';

const customRequire = (name: string) => {
  return require(join(__dirname, name));
};

const distDir = join(__dirname, './dist');

afterAll(() => {
  fs.rmSync(distDir, { recursive: true, force: true });
});

it('should load runtime deps correctly', async () => {
  const res = customRequire('./a.js');
  expect(res.a).toBe(1);
});

it('should load compile-time deps correctly', async () => {
  const res = require('./b.ts');
  expect(res.b).toBe(2);
});

it('should run require.resolve correctly', async () => {
  fs.mkdirSync(distDir, { recursive: true });
  const fileName = 'hello-world.txt';

  fs.writeFileSync(join(distDir, fileName), 'hello world');

  const res = require.resolve(`./dist/${fileName}`);
  expect(res).toContain('/hello-world.txt');
});
