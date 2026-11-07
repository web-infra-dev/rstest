import nativeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const io = { ...nativeFs };

export async function exercise(fs, scenario) {
  const directory = io.mkdtempSync(join(tmpdir(), 'rstest-fs-dependencies-'));
  const target = join(directory, 'target');
  const marker = Object.assign(new Error('blocked by file-local mock'), {
    code: 'MOCK_FS',
  });
  const closeMarker = Object.assign(new Error('close failed'), {
    code: 'MOCK_CLOSE',
  });
  const controller =
    scenario.abortBefore || scenario.abortAfterOpen
      ? new AbortController()
      : undefined;
  if (scenario.abortBefore) controller.abort(marker);
  const originals = new Map();
  let calls = 0;
  let closeCalls = 0;
  let fd;
  let handle;
  const existsAsync = promisify(fs.exists);
  const op = scenario.operation;
  const close = (name, error) => {
    const original = fs[name];
    originals.set(name, original);
    fs[name] = (...args) => {
      closeCalls++;
      if (name.endsWith('Sync')) {
        original(...args);
        if (error) throw error;
        return;
      }
      original(args[0], (actualError) => args.at(-1)(error || actualError));
    };
  };
  try {
    if (
      op.startsWith('read') ||
      op.startsWith('truncate') ||
      op.startsWith('exists') ||
      op === 'realpath' ||
      op.startsWith('lchmod') ||
      scenario.fd
    ) {
      io.writeFileSync(target, 'payload');
    }
    let path = target;
    if (scenario.link) {
      io.mkdirSync(join(directory, 'destination'));
      path = join(directory, 'link');
      io.symlinkSync(join(directory, 'destination'), path, 'junction');
    }
    if (scenario.symbolPath) path = Symbol('path');
    if (scenario.nullPath) path = target + '\0';
    if (scenario.defaultCoercion)
      path = {
        [Symbol.toPrimitive](hint) {
          return hint === 'default' ? target : target + '-wrong';
        },
      };
    const method = scenario.mock;
    const original = fs[method];
    const api =
      op === 'readStream'
        ? 'createReadStream'
        : op === 'writeStream'
          ? 'createWriteStream'
          : op;
    if (
      ![
        'existsPromisified',
        'readStreamConstructor',
        'writeStreamConstructor',
      ].includes(op) &&
      typeof fs[api] !== 'function'
    )
      return { unavailable: true };
    if (scenario.fd) fd = io.openSync(target, 'r+');
    if (scenario.handle) handle = await fs.promises.open(target, 'r');
    const customFs = scenario.customFs ? { ...fs } : undefined;
    originals.set(method, original);
    if (method === 'close' || method === 'closeSync') {
      close(method, marker);
    } else {
      fs[method] = (...args) => {
        calls++;
        if (scenario.style === 'pass') {
          if (scenario.abortAfterOpen) {
            const callback = args.at(-1);
            args[args.length - 1] = (...values) => {
              controller.abort(marker);
              callback(...values);
            };
          }
          return original(...args);
        }
        if (scenario.style === 'partial') {
          args[3] = Math.min(args[3], 2);
          return original(...args);
        }
        if (method.endsWith('Sync') || scenario.throw) throw marker;
        return args.at(-1)(method === 'exists' ? false : marker);
      };
    }
    if (scenario.closeError || scenario.observeClose)
      close('close', scenario.closeError ? closeMarker : undefined);
    let error;
    let value;
    let synchronous;
    let returned = false;
    const data = scenario.empty
      ? Buffer.alloc(0)
      : scenario.view
        ? new DataView(Uint8Array.from(Buffer.from('payload')).buffer)
        : scenario.binary
          ? Buffer.from('payload')
          : scenario.badData
            ? 7
            : 'payload';
    const options = controller
      ? { signal: controller.signal }
      : scenario.utf8
        ? 'utf8'
        : scenario.flush
          ? { flush: true }
          : undefined;
    try {
      if (op === 'existsPromisified') value = await existsAsync(path);
      else if (op.includes('Stream')) {
        let streamOptions = {
          ...(scenario.flush ? { flush: true } : {}),
          ...(handle ? { fd: handle, autoClose: false } : {}),
          ...(customFs ? { fs: customFs } : {}),
        };
        if (scenario.inherited) streamOptions = Object.create(streamOptions);
        if (scenario.hiddenEncoding)
          Object.defineProperty(streamOptions, 'encoding', {
            value: 'invalid-encoding',
          });
        const stream =
          op === 'readStreamConstructor'
            ? new fs.ReadStream(path, streamOptions)
            : op === 'writeStreamConstructor'
              ? new fs.WriteStream(path, streamOptions)
              : fs[api](path, streamOptions);
        if (op.startsWith('read')) {
          value = '';
          const closed = new Promise((resolve) =>
            stream.once('close', resolve),
          );
          try {
            for await (const chunk of stream) value += chunk.toString();
          } finally {
            if (!stream.closed) stream.destroy();
            await closed;
          }
        } else {
          await new Promise((resolve, reject) => {
            let streamError;
            stream.once('error', (error) => {
              streamError = error;
            });
            stream.once('close', () =>
              streamError ? reject(streamError) : resolve(),
            );
            if (scenario.vector) {
              stream.cork();
              stream.write('pay');
              stream.write('load');
              stream.uncork();
              stream.end();
            } else stream.end(data);
          });
        }
      } else if (op.endsWith('Sync')) {
        if (op === 'readFileSync') value = fs[op](fd ?? path, options);
        else if (op === 'truncateSync') value = fs[op](fd ?? path, 3);
        else if (op === 'lchmodSync') value = fs[op](path, 0o600);
        else value = fs[op](fd ?? path, data, options);
      } else {
        value = await new Promise((resolve, reject) => {
          const callback = (error, value) => {
            synchronous = !returned;
            if (op === 'exists') resolve(error);
            else if (error) reject(error);
            else resolve(value);
          };
          if (op === 'truncate') fs[op](fd ?? path, 3, callback);
          else if (op === 'exists' || op === 'realpath') fs[op](path, callback);
          else if (op === 'readFile') fs[op](fd ?? path, callback);
          else if (op === 'lchmod') fs[op](path, 0o600, callback);
          else fs[op](fd ?? path, data, options, callback);
          returned = true;
        });
      }
    } catch (caught) {
      error = caught;
    }
    if (ArrayBuffer.isView(value))
      value = Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString();
    if (typeof value === 'string') value = value.replace(directory, '<root>');
    return {
      calls,
      closeCalls,
      error: error?.code ?? null,
      errorName: error?.name ?? null,
      errors: error?.errors?.map((error) => error.code),
      value,
      synchronous,
      created: io.existsSync(target),
      contents: io.existsSync(target) ? io.readFileSync(target, 'utf8') : null,
    };
  } finally {
    for (const [name, original] of originals) fs[name] = original;
    if (fd !== undefined) io.closeSync(fd);
    if (handle) await handle.close();
    io.rmSync(directory, { recursive: true, force: true });
  }
}
