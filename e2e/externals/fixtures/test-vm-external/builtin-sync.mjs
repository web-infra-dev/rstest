import fs, {
  promises,
  readFile,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';

// Capture the initial named export before another test can synchronize it.
const initialPromises = promises;

export const verifyFileSystemBridges = async () => {
  const require = createRequire(import.meta.url);
  const nativeFs = process.getBuiltinModule('fs');
  const nativeReadFile = nativeFs.promises.readFile;
  const originalReadFile = initialPromises.readFile;
  const replacement = () => 'file-only';
  try {
    initialPromises.readFile = replacement;
    const promiseNamespace = await import('node:fs/promises');
    return {
      identity:
        initialPromises === fs.promises &&
        initialPromises === require('fs/promises') &&
        initialPromises === promiseNamespace.default,
      mockVisible: fs.promises.readFile === replacement,
      nativeUnchanged: nativeFs.promises.readFile === nativeReadFile,
    };
  } finally {
    initialPromises.readFile = originalReadFile;
    nativeFs.promises.readFile = nativeReadFile;
  }
};

export const verifyStreamFactories = () => {
  const nativeFs = process.getBuiltinModule('fs');
  const nativeReadStream = nativeFs.ReadStream;
  const nativeWriteStream = nativeFs.WriteStream;
  const originalReadStream = fs.ReadStream;
  const originalWriteStream = fs.WriteStream;
  class Replacement {
    constructor(path, options) {
      this.path = path;
      this.options = options;
    }
  }
  const options = { fd: -1 };
  try {
    fs.ReadStream = Replacement;
    fs.WriteStream = Replacement;
    const streams = [
      fs.createReadStream('unused-path', options),
      fs.createWriteStream('unused-path', options),
      createReadStream('unused-path', options),
      createWriteStream('unused-path', options),
    ];
    return {
      mockedStreams: streams.every((stream) => stream instanceof Replacement),
      streamArguments: streams.every(
        (stream) => stream.path === 'unused-path' && stream.options === options,
      ),
      nativeConstructorsUnchanged:
        nativeFs.ReadStream === nativeReadStream &&
        nativeFs.WriteStream === nativeWriteStream,
    };
  } finally {
    fs.ReadStream = originalReadStream;
    fs.WriteStream = originalWriteStream;
  }
};

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
