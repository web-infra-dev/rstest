import fs, { readFile } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

export const verifyBuiltinSync = () => {
  const originalReadFile = fs.readFile;
  const replacement = () => {};
  fs.readFile = replacement;
  syncBuiltinESMExports();
  const synchronized = readFile === replacement;
  fs.readFile = originalReadFile;
  syncBuiltinESMExports();
  return synchronized;
};
