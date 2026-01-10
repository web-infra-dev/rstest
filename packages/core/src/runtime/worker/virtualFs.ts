import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'pathe';

type VirtualFiles = Record<string, string>;

let installed = false;
let virtualFiles: VirtualFiles = {};

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
  if (!virtualFiles || Object.keys(virtualFiles).length === 0) return null;

  const raw = toFsPath(p);
  const normalized = path.normalize(raw);
  const alt = normalized.replace(/\\/g, '/');

  const content =
    virtualFiles[normalized] ??
    virtualFiles[alt] ??
    virtualFiles[decodeURIComponent(normalized)] ??
    virtualFiles[decodeURIComponent(alt)];

  if (typeof content !== 'string') return null;

  return {
    content,
    isWasm: normalized.endsWith('.wasm') || alt.endsWith('.wasm'),
  };
};

export const setVirtualFiles = (files: VirtualFiles): void => {
  virtualFiles = files || {};
};

export const clearVirtualFiles = (): void => {
  virtualFiles = {};
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

  originals.promisesReadFile = fs.promises.readFile.bind(fs.promises);
  originals.promisesAccess = fs.promises.access.bind(fs.promises);
  originals.promisesStat = fs.promises.stat.bind(fs.promises);

  fs.readFileSync = ((filePath: any, options?: any) => {
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

  fs.readFile = ((filePath: any, options: any, callback?: any) => {
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

  fs.existsSync = ((filePath: any) => {
    if (findVirtualContent(filePath)) return true;
    return originals.existsSync!(filePath);
  }) as any;

  fs.statSync = ((filePath: any, options?: any) => {
    const v = findVirtualContent(filePath);
    if (v) {
      const size = v.isWasm
        ? Buffer.byteLength(Buffer.from(v.content, 'base64'))
        : Buffer.byteLength(v.content, 'utf-8');
      return makeFakeStats(size);
    }
    return originals.statSync!(filePath, options);
  }) as any;

  fs.createReadStream = ((filePath: any, options?: any) => {
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
  fs.promises.readFile = (async (filePath: any, options?: any) => {
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
    return originals.promisesReadFile!(filePath, options);
  }) as typeof fs.promises.readFile;

  fs.promises.access = (async (filePath: any, mode?: any) => {
    if (findVirtualContent(filePath)) return;
    return originals.promisesAccess!(filePath, mode);
  }) as typeof fs.promises.access;

  fs.promises.stat = (async (filePath: any, options?: any) => {
    const v = findVirtualContent(filePath);
    if (v) {
      const size = v.isWasm
        ? Buffer.byteLength(Buffer.from(v.content, 'base64'))
        : Buffer.byteLength(v.content, 'utf-8');
      return makeFakeStats(size);
    }
    return originals.promisesStat!(filePath, options);
  }) as typeof fs.promises.stat;
};
