import fs, { readFile } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';

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

export const verifyLateBuiltinSync = async () => {
  const require = createRequire(import.meta.url);
  const promises = require('fs/promises');
  const original = promises.readFile;
  const synchronized = () => 'synchronized';
  const unsynchronized = () => 'unsynchronized';
  try {
    promises.readFile = synchronized;
    syncBuiltinESMExports();
    promises.readFile = unsynchronized;
    const namespace = await import('node:fs/promises');
    const result = {
      defaultExport: namespace.default === promises,
      synchronized: namespace.readFile === synchronized,
      unsynchronized: namespace.default.readFile === unsynchronized,
    };
    syncBuiltinESMExports();
    return {
      ...result,
      resynchronized: namespace.readFile === unsynchronized,
    };
  } finally {
    promises.readFile = original;
    syncBuiltinESMExports();
  }
};
