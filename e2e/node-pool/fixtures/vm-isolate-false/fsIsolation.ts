import fs, { readFileSync } from 'node:fs';
import fsPromises, { readFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { afterAll, expect, rs } from '@rstest/core';
import 'fs-extra';

const nativeFs = process.getBuiltinModule('fs');
const nativeReadFileSync = nativeFs.readFileSync;
const load = createRequire(import.meta.url);

expect(rs.isMockFunction(fs.readFileSync)).toBe(false);
expect(rs.isMockFunction(fsPromises.readFile)).toBe(false);
const sharedFile = new URL('./shared.ts', import.meta.url);
expect(fs.readFileSync(sharedFile, 'utf8')).toBe(
  nativeReadFileSync(sharedFile, 'utf8'),
);
expect(load('fs')).toBe(fs);
expect(load('node:fs')).toBe(fs);
expect(fs.promises).toBe(fsPromises);
expect(load('fs/promises')).toBe(fsPromises);
expect(load('node:fs/promises')).toBe(fsPromises);
console.log(`VM_PROCESS_ID:${process.pid}`);

afterAll(() => {
  const close = fs.closeSync;
  // The file boundary must restore this spy before native IO uses it again.
  rs.spyOn(fs, 'closeSync').mockImplementation((fd) => {
    close(fd);
    clearTimeout(undefined);
  });
  rs.spyOn(fs, 'readFileSync').mockReturnValue('file-only');
  rs.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('file-only'));
  syncBuiltinESMExports();
  expect(readFileSync).toBe(fs.readFileSync);
  expect(readFile).toBe(fsPromises.readFile);
  expect(nativeFs.readFileSync).toBe(fs.readFileSync);
  expect(nativeFs.closeSync).toBe(fs.closeSync);
});
