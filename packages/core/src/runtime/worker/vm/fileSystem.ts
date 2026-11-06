import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import { dirname, isAbsolute, parse, resolve, sep } from 'node:path';
import { nextTick } from 'node:process';
import { fileURLToPath } from 'node:url';
import { deprecate, inspect, promisify } from 'node:util';

type Operation = (...args: unknown[]) => unknown;
type Callback = (...args: unknown[]) => void;
type FileSystem = Record<PropertyKey, unknown>;
type Options = Record<string, unknown>;

const legacyNumericTruncate = Number(process.versions.node.split('.')[0]) < 24;
const warnNumericTruncate = deprecate(
  () => {},
  'Using fs.truncate with a file descriptor is deprecated. Please use fs.ftruncate with a file descriptor instead.',
  'DEP0081',
);

// Only public-to-public calls belong here. Native bindings (including async
// readFile and the synchronous UTF-8 fast paths) do not consult these exports.
const dependencies: Record<string, readonly string[]> = {
  exists: ['access'],
  writeFile: ['open', 'write', 'fsync', 'close'],
  appendFile: ['writeFile'],
  writeFileSync: ['openSync', 'writeSync', 'fsyncSync', 'closeSync'],
  appendFileSync: ['writeFileSync'],
  readFileSync: ['openSync', 'readSync', 'closeSync'],
  truncate: legacyNumericTruncate
    ? ['open', 'close', 'ftruncate']
    : ['open', 'close'],
  truncateSync: ['openSync', 'ftruncateSync', 'closeSync'],
  lchmod: ['open', 'fchmod', 'close'],
  lchmodSync: ['openSync', 'fchmodSync', 'closeSync'],
  realpath: ['lstat', 'stat', 'readlink'],
};

const invalidType = (
  name: string,
  expected: string,
  value: unknown,
): TypeError =>
  Object.assign(
    new TypeError(
      `The "${name}" argument must be of type ${expected}. Received ${inspect(value)}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );

const callbackOf = (value: unknown): Callback => {
  if (typeof value !== 'function') throw invalidType('cb', 'function', value);
  return value as Callback;
};

const optionsOf = (value: unknown, defaults: Options = {}): Options => {
  let options: Options;
  if (value == null || typeof value === 'function') options = defaults;
  else if (typeof value === 'string')
    options = { ...defaults, encoding: value };
  else if (typeof value === 'object') options = value as Options;
  else throw invalidType('options', 'string or Object', value);
  if (
    options.encoding &&
    options.encoding !== 'buffer' &&
    !Buffer.isEncoding(options.encoding as string)
  ) {
    throw Object.assign(
      new TypeError(
        `The argument 'encoding' is invalid encoding. Received ${inspect(options.encoding)}`,
      ),
      { code: 'ERR_INVALID_ARG_VALUE' },
    );
  }
  const signal = options.signal;
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== 'object' || !('aborted' in signal))
  ) {
    throw invalidType('options.signal', 'AbortSignal', signal);
  }
  return options;
};

const isFd = (value: unknown): value is number =>
  typeof value === 'number' && value === (value | 0);

const integerLength = (value: unknown): number => {
  if (typeof value !== 'number') throw invalidType('len', 'number', value);
  if (!Number.isSafeInteger(value)) {
    throw Object.assign(
      new RangeError(`The value of "len" is out of range. Received ${value}`),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
  return Math.max(0, value);
};

const combineErrors = (primary: unknown, secondary: unknown): unknown => {
  if (!primary || !secondary || primary === secondary)
    return secondary || primary;
  const errors = Reflect.get(Object(primary), 'errors');
  if (Array.isArray(errors)) {
    errors.push(secondary);
    return primary;
  }
  return Object.assign(
    new AggregateError(
      [primary, secondary],
      Reflect.get(Object(primary), 'message'),
    ),
    { code: Reflect.get(Object(primary), 'code') },
  );
};

const aborted = (signal: unknown): Error | undefined => {
  if (signal && Reflect.get(Object(signal), 'aborted')) {
    return Object.assign(
      new Error('The operation was aborted', {
        cause: Reflect.get(Object(signal), 'reason'),
      }),
      {
        name: 'AbortError',
        code: 'ABORT_ERR',
      },
    );
  }
  return undefined;
};

/** Install public fs dependency dispatch without mutating the native module. */
export const installFileSystemBridges = (
  fs: FileSystem,
  wrap: (original: Operation, replacement: Operation) => unknown,
): void => {
  const native: FileSystem = { ...fs };
  const baseline: FileSystem = { ...fs };
  // These dynamically selected properties are fs methods or user replacements.
  const call = (object: FileSystem, name: string, args: unknown[]): unknown =>
    Reflect.apply(object[name] as Operation, object, args);
  const local = (name: string, args: unknown[]): unknown =>
    call(fs, name, args);
  const original = (name: string, args: unknown[]): unknown =>
    call(native, name, args);
  const changed = (name: string): boolean =>
    (dependencies[name] ?? []).some(
      (dependency) =>
        fs[dependency] !== baseline[dependency] || changed(dependency),
    );

  const finish = (
    fd: number,
    owned: boolean,
    error: unknown,
    callback: Callback,
  ): void => {
    if (!owned) callback(error || null);
    else if (error)
      local('close', [
        fd,
        (closeError: unknown) => callback(combineErrors(error, closeError)),
      ]);
    else local('close', [fd, callback]);
  };

  function exists(path: unknown, callback: unknown): unknown {
    if (!changed('exists')) return original('exists', [path, callback]);
    const cb = callbackOf(callback);
    try {
      return local('access', [
        path,
        constants.F_OK,
        (error: unknown) => cb(!error),
      ]);
    } catch {
      return cb(false);
    }
  }
  Object.defineProperty(exists, promisify.custom, {
    value: (path: unknown) =>
      new Promise((resolveExists) => local('exists', [path, resolveExists])),
  });

  function writeFile(
    path: unknown,
    data: unknown,
    options: unknown,
    callback: unknown,
  ): unknown {
    if (!changed('writeFile'))
      return original('writeFile', [path, data, options, callback]);
    const cb = callbackOf(callback || options);
    const opts = optionsOf(options, {
      encoding: 'utf8',
      mode: 0o666,
      flag: 'w',
      flush: false,
    });
    const flush = opts.flush ?? false;
    if (typeof flush !== 'boolean')
      throw invalidType('options.flush', 'boolean', flush);
    if (!ArrayBuffer.isView(data) && typeof data !== 'string')
      throw invalidType(
        'data',
        'string or Buffer, TypedArray, or DataView',
        data,
      );
    const buffer =
      typeof data === 'string'
        ? Buffer.from(data, (opts.encoding || 'utf8') as BufferEncoding)
        : (data as ArrayBufferView);
    const write = (
      fd: number,
      owned: boolean,
      offset: number,
      length: number,
    ): void => {
      const abort = aborted(opts.signal);
      if (abort) return finish(fd, owned, abort, cb);
      local('write', [
        fd,
        buffer,
        offset,
        length,
        null,
        (error: unknown, written: number) => {
          if (error) return finish(fd, owned, error, cb);
          if (written !== length)
            return write(fd, owned, offset + written, length - written);
          if (flush)
            local('fsync', [
              fd,
              (syncError: unknown) => finish(fd, owned, syncError, cb),
            ]);
          else finish(fd, owned, null, cb);
        },
      ]);
    };
    if (isFd(path)) return write(path, false, 0, buffer.byteLength);
    const abort = aborted(opts.signal);
    if (abort) return cb(abort);
    return local('open', [
      path,
      opts.flag || 'w',
      opts.mode,
      (error: unknown, fd: number) => {
        if (error) cb(error);
        else write(fd, true, 0, buffer.byteLength);
      },
    ]);
  }

  function writeFileSync(
    path: unknown,
    data: unknown,
    options: unknown,
  ): unknown {
    if (!changed('writeFileSync'))
      return original('writeFileSync', [path, data, options]);
    const opts = optionsOf(options, {
      encoding: 'utf8',
      mode: 0o666,
      flag: 'w',
      flush: false,
    });
    const flush = opts.flush ?? false;
    if (typeof flush !== 'boolean')
      throw invalidType('options.flush', 'boolean', flush);
    if (
      typeof data === 'string' &&
      (opts.encoding === 'utf8' || opts.encoding === 'utf-8')
    ) {
      return original('writeFileSync', [path, data, options]);
    }
    if (!ArrayBuffer.isView(data) && typeof data !== 'string')
      throw invalidType(
        'data',
        'string or Buffer, TypedArray, or DataView',
        data,
      );
    const buffer =
      typeof data === 'string'
        ? Buffer.from(data, (opts.encoding || 'utf8') as BufferEncoding)
        : (data as ArrayBufferView);
    const owned = !isFd(path);
    const fd = owned
      ? local('openSync', [path, opts.flag || 'w', opts.mode])
      : path;
    try {
      let offset = 0;
      while (offset < buffer.byteLength)
        offset += local('writeSync', [
          fd,
          buffer,
          offset,
          buffer.byteLength - offset,
        ]) as number;
      if (flush) local('fsyncSync', [fd]);
    } finally {
      if (owned) local('closeSync', [fd]);
    }
    return undefined;
  }

  const appendOptions = (path: unknown, value: unknown): Options => {
    const opts = optionsOf(value, { encoding: 'utf8', mode: 0o666, flag: 'a' });
    const copy: Options = {};
    for (const key in opts) copy[key] = opts[key];
    if (!copy.flag || isFd(path)) copy.flag = 'a';
    return copy;
  };
  function appendFile(
    path: unknown,
    data: unknown,
    options: unknown,
    callback: unknown,
  ): unknown {
    if (!changed('appendFile'))
      return original('appendFile', [path, data, options, callback]);
    const cb = callbackOf(callback || options);
    return local('writeFile', [path, data, appendOptions(path, options), cb]);
  }
  function appendFileSync(
    path: unknown,
    data: unknown,
    options: unknown,
  ): unknown {
    if (!changed('appendFileSync'))
      return original('appendFileSync', [path, data, options]);
    return local('writeFileSync', [path, data, appendOptions(path, options)]);
  }

  function readFileSync(path: unknown, options: unknown): unknown {
    if (!changed('readFileSync'))
      return original('readFileSync', [path, options]);
    const opts = optionsOf(options, { flag: 'r' });
    if (
      opts.encoding === 'utf8' ||
      opts.encoding === 'utf-8' ||
      (isFd(path) && path < 0)
    ) {
      return original('readFileSync', [path, options]);
    }
    const owned = !isFd(path);
    const fd = owned ? local('openSync', [path, opts.flag, 0o666]) : path;
    let result: Buffer;
    try {
      // Node's readFileSync consults the native stat binding, not fs.fstatSync.
      const stats = original('fstatSync', [fd]) as {
        size: number;
        isFile(): boolean;
      };
      const size = stats.isFile() ? stats.size : 0;
      const chunks: Buffer[] = [];
      let position = 0;
      const buffer = size ? Buffer.allocUnsafe(size) : undefined;
      while (!size || position < size) {
        const chunk = buffer ?? Buffer.allocUnsafe(8192);
        const bytes = local('readSync', [
          fd,
          chunk,
          size ? position : 0,
          size ? size - position : chunk.length,
        ]) as number;
        if (!bytes) break;
        if (!size) chunks.push(chunk.subarray(0, bytes));
        position += bytes;
      }
      result = buffer
        ? buffer.subarray(0, position)
        : Buffer.concat(chunks, position);
    } finally {
      if (owned) local('closeSync', [fd]);
    }
    return opts.encoding
      ? result.toString(opts.encoding as BufferEncoding)
      : result;
  }

  function truncate(
    path: unknown,
    length: unknown,
    callback: unknown,
  ): unknown {
    if (!changed('truncate'))
      return original('truncate', [path, length, callback]);
    if (legacyNumericTruncate && typeof path === 'number') {
      warnNumericTruncate();
      return local('ftruncate', [path, length, callback]);
    }
    const len = integerLength(
      typeof length === 'function' || length === undefined ? 0 : length,
    );
    const cb = callbackOf(typeof length === 'function' ? length : callback);
    return local('open', [
      path,
      'r+',
      (error: unknown, fd: number) => {
        if (error) return cb(error);
        original('ftruncate', [
          fd,
          len,
          (error: unknown) => finish(fd, true, error, cb),
        ]);
      },
    ]);
  }
  function truncateSync(path: unknown, length: unknown): unknown {
    if (!changed('truncateSync'))
      return original('truncateSync', [path, length]);
    if (legacyNumericTruncate && typeof path === 'number') {
      warnNumericTruncate();
      return local('ftruncateSync', [path, length]);
    }
    const fd = local('openSync', [path, 'r+']);
    try {
      return local('ftruncateSync', [fd, length === undefined ? 0 : length]);
    } finally {
      local('closeSync', [fd]);
    }
  }

  function lchmod(path: unknown, mode: unknown, callback: unknown): unknown {
    if (!changed('lchmod')) return original('lchmod', [path, mode, callback]);
    const cb = callbackOf(callback);
    const parsedMode =
      typeof mode === 'string' && /^[0-7]+$/.test(mode)
        ? Number.parseInt(mode, 8)
        : mode;
    if (
      typeof parsedMode !== 'number' ||
      !Number.isInteger(parsedMode) ||
      parsedMode < 0 ||
      parsedMode > 0xffffffff
    ) {
      return original('lchmod', [path, mode, callback]);
    }
    const flags =
      constants.O_WRONLY | (Reflect.get(constants, 'O_SYMLINK') as number);
    return local('open', [
      path,
      flags,
      (error: unknown, fd: number) => {
        if (error) return cb(error);
        local('fchmod', [
          fd,
          parsedMode,
          (error: unknown) => finish(fd, true, error, cb),
        ]);
      },
    ]);
  }
  function lchmodSync(path: unknown, mode: unknown): unknown {
    if (!changed('lchmodSync')) return original('lchmodSync', [path, mode]);
    const flags =
      constants.O_WRONLY | (Reflect.get(constants, 'O_SYMLINK') as number);
    const fd = local('openSync', [path, flags]);
    try {
      return local('fchmodSync', [fd, mode]);
    } finally {
      local('closeSync', [fd]);
    }
  }

  function realpath(
    path: unknown,
    options: unknown,
    callback: unknown,
  ): unknown {
    if (!changed('realpath'))
      return original('realpath', [path, options, callback]);
    const cb = callbackOf(typeof options === 'function' ? options : callback);
    const opts = optionsOf(options);
    const value = path instanceof URL ? fileURLToPath(path) : path;
    // realpath uses default-hint coercion, which also rejects Symbols.
    const input = typeof value === 'string' ? value : (value as string) + '';
    if (input.includes('\0'))
      return original('realpath', [input, options, callback]);
    // Public realpath walks links through lstat/stat/readlink; realpath.native
    // remains the native binding, including its independent fast path.
    let pending = resolve(input);
    const knownHard = new Set<string>();
    const seenLinks = new Map<string, string>();
    const encode = (value: string) =>
      opts.encoding === 'buffer'
        ? Buffer.from(value)
        : opts.encoding
          ? Buffer.from(value).toString(opts.encoding as BufferEncoding)
          : value;
    const restart = (): void => {
      let base = parse(pending).root;
      const parts = pending.slice(base.length).split(sep).filter(Boolean);
      let index = 0;
      const advance = (): void => {
        if (index === parts.length) return cb(null, encode(base));
        base = resolve(base, parts[index++]!);
        if (knownHard.has(base)) return nextTick(advance);
        local('lstat', [
          base,
          { bigint: true },
          (
            error: unknown,
            stats: { isSymbolicLink(): boolean; dev: bigint; ino: bigint },
          ) => {
            if (error) return cb(error);
            if (!stats.isSymbolicLink()) {
              knownHard.add(base);
              return nextTick(advance);
            }
            const redirect = (target: string): void => {
              pending = resolve(
                isAbsolute(target) ? target : resolve(dirname(base), target),
                ...parts.slice(index),
              );
              restart();
            };
            const id =
              process.platform === 'win32'
                ? undefined
                : `${BigInt.prototype.toString.call(stats.dev, 32)}:${BigInt.prototype.toString.call(stats.ino, 32)}`;
            if (id !== undefined && seenLinks.has(id))
              return redirect(seenLinks.get(id)!);
            local('stat', [
              base,
              (error: unknown) => {
                if (error) return cb(error);
                local('readlink', [
                  base,
                  (error: unknown, target: string) => {
                    if (error) return cb(error);
                    if (id !== undefined) seenLinks.set(id, target);
                    redirect(target);
                  },
                ]);
              },
            ]);
          },
        ]);
      };
      if (process.platform === 'win32' && !knownHard.has(base))
        local('lstat', [
          base,
          (error: unknown) => {
            if (error) return cb(error);
            knownHard.add(base);
            return advance();
          },
        ]);
      else nextTick(advance);
    };
    return restart();
  }

  const streamConstructor = (name: string): Operation => {
    const target = native[name] as Operation;
    const argumentsFor = (args: unknown[]): unknown[] => {
      const options = args[1];
      if (
        options != null &&
        typeof options !== 'string' &&
        typeof options !== 'object'
      )
        return args;
      const encoding =
        typeof options === 'string'
          ? options
          : options && Reflect.get(options, 'encoding');
      const signal =
        typeof options === 'object' && options !== null
          ? Reflect.get(options, 'signal')
          : undefined;
      // Let Node produce its own validation errors before any I/O, including
      // non-enumerable options which its subsequent copy does not retain.
      if (
        (encoding &&
          encoding !== 'buffer' &&
          !Buffer.isEncoding(encoding as string)) ||
        (signal !== undefined &&
          (signal === null ||
            typeof signal !== 'object' ||
            !('aborted' in signal)))
      )
        return args;
      const copy: Options =
        typeof options === 'string' ? { encoding: options } : {};
      if (options && typeof options === 'object') {
        for (const key in options) copy[key] = Reflect.get(options, key);
      }
      // FileHandle streams provide their own operations and reject options.fs.
      if (copy.fs || (copy.fd !== null && typeof copy.fd === 'object'))
        return args;
      copy.fs = fs;
      return [args[0], copy];
    };
    return new Proxy(target, {
      apply: (target, receiver, args) =>
        Reflect.apply(target, receiver, argumentsFor(args)),
      construct: (target, args, newTarget) =>
        Reflect.construct(target, argumentsFor(args), newTarget),
    });
  };

  const bridges: Record<string, Operation> = {
    exists,
    writeFile,
    writeFileSync,
    appendFile,
    appendFileSync,
    readFileSync,
    truncate,
    truncateSync,
    lchmod,
    lchmodSync,
    realpath,
    ReadStream: streamConstructor('ReadStream'),
    WriteStream: streamConstructor('WriteStream'),
  };
  for (const [name, bridge] of Object.entries(bridges)) {
    const value = native[name];
    if (typeof value !== 'function') continue;
    for (const key of Reflect.ownKeys(value)) {
      if (!Object.hasOwn(bridge, key))
        Object.defineProperty(
          bridge,
          key,
          Object.getOwnPropertyDescriptor(value, key)!,
        );
    }
    fs[name] = wrap(value as Operation, bridge);
    baseline[name] = fs[name];
  }
};
