import fs, { readFileSync } from 'node:fs';
import fsPromises, { readFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { afterAll, expect, rs } from '@rstest/core';
import 'fs-extra';

const marker = Symbol.for('rstest.fs.file-only');
const nativeFs = process.getBuiltinModule('fs');
const nativeReadFileSync = nativeFs.readFileSync;
const nativeCloseSync = nativeFs.closeSync;
const load = createRequire(import.meta.url);

expect(Reflect.has(fs, marker)).toBe(false);
expect(Reflect.has(fsPromises, marker)).toBe(false);
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
  // Native IO after timer teardown must not call back into this VM closure.
  fs.closeSync = (fd) => {
    close(fd);
    clearTimeout(undefined);
  };
  rs.spyOn(fs, 'readFileSync').mockReturnValue('file-only');
  rs.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('file-only'));
  Object.defineProperty(fs, marker, { configurable: true, value: true });
  Reflect.set(fsPromises, marker, true);
  syncBuiltinESMExports();
  expect(readFileSync).toBe(fs.readFileSync);
  expect(readFile).toBe(fsPromises.readFile);
  expect(nativeFs.readFileSync).toBe(nativeReadFileSync);
  expect(nativeFs.closeSync).toBe(nativeCloseSync);
});
