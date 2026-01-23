import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'pathe';

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

// TS types for ESM imports mark Node built-in module properties as readonly.
// The actual `fs` export object is mutable at runtime, and we intentionally
// patch it in federation mode so third-party runtimes can read in-memory assets.
const mutableFs = fs as unknown as Mutable<typeof fs>;

type VirtualFiles = Record<string, string>;

let installed = false;
let virtualFiles: VirtualFiles = {};
let hasVirtualFiles = false;

// Keep references so we can fully restore the original fs behavior when
// federation mode is toggled off in non-isolated workers/watch mode.
const originals: {
  readFileSync?: typeof fs.readFileSync;
  readFile?: typeof fs.readFile;
  existsSync?: typeof fs.existsSync;
  statSync?: typeof fs.statSync;
  createReadStream?: typeof fs.createReadStream;
  promisesReadFile?: typeof fs.promises.readFile;
  promisesAccess?: typeof fs.promises.access;
  promisesStat?: typeof fs.promises.stat;
} = {};

const toFsPath = (p: string | URL): string => {
  if (p instanceof URL) return fileURLToPath(p);

  if (typeof p === 'string' && p.startsWith('file:')) {
    try {
      return fileURLToPath(new URL(p));
    } catch {
      // fall through
    }
  }

  return String(p);
};

const findVirtualContent = (
  p: string | URL,
): { content: string; isWasm: boolean } | null => {
  if (!hasVirtualFiles) return null;

  const raw = toFsPath(p);
  const normalized = path.normalize(raw);
  const alt = normalized.replace(/\\/g, '/');

  const maybeDecode = (value: string): string | null => {
    if (!value.includes('%')) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  };

  const decodedNormalized = maybeDecode(normalized);
  const decodedAlt = alt !== normalized ? maybeDecode(alt) : null;

  const content =
    virtualFiles[normalized] ??
    virtualFiles[alt] ??
    (decodedNormalized ? virtualFiles[decodedNormalized] : undefined) ??
    (decodedAlt ? virtualFiles[decodedAlt] : undefined);

  if (typeof content !== 'string') return null;

  return {
    content,
    isWasm: normalized.endsWith('.wasm') || alt.endsWith('.wasm'),
  };
};

export const setVirtualFiles = (files: VirtualFiles): void => {
  virtualFiles = files || {};
  hasVirtualFiles = Object.keys(virtualFiles).length > 0;
};

export const clearVirtualFiles = (): void => {
  virtualFiles = {};
  hasVirtualFiles = false;
};

const makeFakeStats = (size: number): any => {
  const now = new Date();
  return {
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size,
    mtime: now,
    ctime: now,
    atime: now,
    birthtime: now,
    mode: 0o100644,
  };
};

export const installVirtualFs = (): void => {
  if (installed) return;
  installed = true;

  originals.readFileSync = fs.readFileSync;
  originals.readFile = fs.readFile;
  originals.existsSync = fs.existsSync;
  originals.statSync = fs.statSync;
  originals.createReadStream = fs.createReadStream;

  originals.promisesReadFile = fs.promises.readFile;
  originals.promisesAccess = fs.promises.access;
  originals.promisesStat = fs.promises.stat;

  // Important: this patches Node's builtin `fs` export object globally. This is
  // only intended for federation mode workers so the MF runtime can read assets
  // from Rstest's in-memory output without requiring `dev.writeToDisk = true`.
  mutableFs.readFileSync = ((filePath: any, options?: any) => {
    const v = findVirtualContent(filePath);
    if (v) {
      const encoding =
        typeof options === 'string'
          ? options
          : options && typeof options === 'object'
            ? options.encoding
            : undefined;
      const buffer = v.isWasm
        ? Buffer.from(v.content, 'base64')
        : Buffer.from(v.content, 'utf-8');
      return encoding ? buffer.toString(encoding) : buffer;
    }
    return originals.readFileSync!(filePath, options);
  }) as any;

  mutableFs.readFile = ((filePath: any, options: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? undefined : options;
    const v = findVirtualContent(filePath);
    if (v) {
      const encoding =
        typeof opts === 'string'
          ? opts
          : opts && typeof opts === 'object'
            ? opts.encoding
            : undefined;
      const buffer = v.isWasm
        ? Buffer.from(v.content, 'base64')
        : Buffer.from(v.content, 'utf-8');
      queueMicrotask(() => {
        cb(null, encoding ? buffer.toString(encoding) : buffer);
      });
      return;
    }
    return originals.readFile!(filePath, options, cb);
  }) as any;

  mutableFs.existsSync = ((filePath: any) => {
    if (findVirtualContent(filePath)) return true;
    return originals.existsSync!(filePath);
  }) as any;

  mutableFs.statSync = ((filePath: any, options?: any) => {
    const v = findVirtualContent(filePath);
    if (v) {
      const size = v.isWasm
        ? Buffer.byteLength(Buffer.from(v.content, 'base64'))
        : Buffer.byteLength(v.content, 'utf-8');
      return makeFakeStats(size);
    }
    return originals.statSync!(filePath, options);
  }) as any;

  mutableFs.createReadStream = ((filePath: any, options?: any) => {
    const v = findVirtualContent(filePath);
    if (v) {
      const buffer = v.isWasm
        ? Buffer.from(v.content, 'base64')
        : Buffer.from(v.content, 'utf-8');
      const stream = Readable.from(buffer);
      // Best-effort compatibility with consumers that read `.path`.
      (stream as any).path = toFsPath(filePath);
      return stream as any;
    }
    return originals.createReadStream!(filePath, options);
  }) as any;

  // Patch the promises API as well, since many runtimes use `fs.promises`.
  (mutableFs.promises as Mutable<typeof fs.promises>).readFile = (async (
    filePath: any,
    options?: any,
  ) => {
    const v = findVirtualContent(filePath);
    if (v) {
      const encoding =
        typeof options === 'string'
          ? options
          : options && typeof options === 'object'
            ? options.encoding
            : undefined;
      const buffer = v.isWasm
        ? Buffer.from(v.content, 'base64')
        : Buffer.from(v.content, 'utf-8');
      return encoding ? buffer.toString(encoding) : buffer;
    }
    return originals.promisesReadFile!.call(fs.promises, filePath, options);
  }) as typeof fs.promises.readFile;

  (mutableFs.promises as Mutable<typeof fs.promises>).access = (async (
    filePath: any,
    mode?: any,
  ) => {
    if (findVirtualContent(filePath)) return;
    return originals.promisesAccess!.call(fs.promises, filePath, mode);
  }) as typeof fs.promises.access;

  (mutableFs.promises as Mutable<typeof fs.promises>).stat = (async (
    filePath: any,
    options?: any,
  ) => {
    const v = findVirtualContent(filePath);
    if (v) {
      const size = v.isWasm
        ? Buffer.byteLength(Buffer.from(v.content, 'base64'))
        : Buffer.byteLength(v.content, 'utf-8');
      return makeFakeStats(size);
    }
    return originals.promisesStat!.call(fs.promises, filePath, options);
  }) as typeof fs.promises.stat;
};

export const uninstallVirtualFs = (): void => {
  if (!installed) return;

  // Always reset virtual state, even if restoration below throws for any reason.
  clearVirtualFiles();

  if (originals.readFileSync) mutableFs.readFileSync = originals.readFileSync;
  if (originals.readFile) mutableFs.readFile = originals.readFile;
  if (originals.existsSync) mutableFs.existsSync = originals.existsSync;
  if (originals.statSync) mutableFs.statSync = originals.statSync;
  if (originals.createReadStream)
    mutableFs.createReadStream = originals.createReadStream;

  if (originals.promisesReadFile) {
    (mutableFs.promises as Mutable<typeof fs.promises>).readFile =
      originals.promisesReadFile;
  }
  if (originals.promisesAccess) {
    (mutableFs.promises as Mutable<typeof fs.promises>).access =
      originals.promisesAccess;
  }
  if (originals.promisesStat) {
    (mutableFs.promises as Mutable<typeof fs.promises>).stat =
      originals.promisesStat;
  }

  installed = false;
};
