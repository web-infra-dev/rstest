import fs, {
  promises,
  readFile,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Capture the initial named export before another test can synchronize it.
const initialPromises = promises;

export const verifyCompositeFileSystem = async () => {
  const native = process.getBuiltinModule('fs');
  const directory = native.mkdtempSync(join(tmpdir(), 'rstest-fs-composites-'));
  const input = join(directory, 'input');
  const output = join(directory, 'output');
  native.writeFileSync(input, 'original');
  const originalOpen = fs.open;
  const originalOpenSync = fs.openSync;
  const originalWrite = fs.write;
  const originalClose = fs.close;
  const marker = Object.assign(new Error('mocked open'), { code: 'MOCK_OPEN' });
  const code = (fn) =>
    new Promise((resolve) => fn((error) => resolve(error?.code ?? null)));
  try {
    fs.open = (...args) => args.at(-1)(marker);
    const nativeOpenMockVisible = native.open === fs.open;
    const namespace = await import('node:fs');
    const operationErrors = {
      writeFile: await code((cb) => fs.writeFile(output, 'data', cb)),
      namedWriteFile: await code((cb) =>
        namespace.writeFile(output, 'data', cb),
      ),
      appendFile: await code((cb) => fs.appendFile(output, 'data', cb)),
      truncate: await code((cb) => fs.truncate(input, 0, cb)),
    };
    if (typeof fs.lchmod === 'function')
      operationErrors.lchmod = await code((cb) => fs.lchmod(input, 0o600, cb));
    fs.openSync = () => {
      throw marker;
    };
    for (const [name, operation] of Object.entries({
      writeFileSync: () => fs.writeFileSync(output, Buffer.from('data')),
      appendFileSync: () => fs.appendFileSync(output, Buffer.from('data')),
      readFileSync: () => fs.readFileSync(input),
      truncateSync: () => fs.truncateSync(input, 0),
    })) {
      try {
        operation();
        operationErrors[name] = null;
      } catch (error) {
        operationErrors[name] = error.code;
      }
    }
    fs.openSync = originalOpenSync;
    const inputContents = native.readFileSync(input, 'utf8');
    const outputContents = native.existsSync(output)
      ? native.readFileSync(output, 'utf8')
      : null;
    fs.open = originalOpen;
    let closeCalls = 0;
    fs.write = (...args) => args.at(-1)(marker);
    fs.close = (fd, callback) => {
      closeCalls++;
      originalClose(fd, callback);
    };
    const writeError = await code((cb) => fs.writeFile(output, 'data', cb));
    return {
      operationErrors,
      inputContents,
      outputContents,
      writeError,
      closeCalls,
      nativeMocksVisible: nativeOpenMockVisible && native.close === fs.close,
    };
  } finally {
    fs.open = originalOpen;
    fs.openSync = originalOpenSync;
    fs.write = originalWrite;
    fs.close = originalClose;
    native.rmSync(directory, { recursive: true, force: true });
  }
};

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
      nativeMutationVisible: nativeFs.promises.readFile === replacement,
    };
  } finally {
    initialPromises.readFile = originalReadFile;
    nativeFs.promises.readFile = nativeReadFile;
  }
};

export const verifyStreamFactories = () => {
  const nativeFs = process.getBuiltinModule('fs');
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
      nativeConstructorsReplaced:
        nativeFs.ReadStream === Replacement &&
        nativeFs.WriteStream === Replacement,
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
