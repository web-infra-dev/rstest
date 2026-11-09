import fs, { linkSync } from 'node:fs';
import fsPromises, { link } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { afterAll, expect, it, registerFileCleanup, rs } from '@rstest/core';

const load = createRequire(import.meta.url);
const marker = Symbol.for('rstest.native-fs.probe');
const createMocks = () => {
  const target = {
    method: () => 'original method',
    get value() {
      return 'original getter';
    },
  };
  const fn = rs.fn(() => 'initial implementation');
  fn.mockReturnValue('mocked implementation');
  fn();
  fn.mockReturnValueOnce('pending implementation');
  const method = rs.spyOn(target, 'method').mockReturnValue('mocked method');
  const getter = rs
    .spyOn(target, 'value', 'get')
    .mockReturnValue('mocked getter');
  target.method();
  void target.value;
  return {
    target,
    fn,
    method,
    getter,
    capturedMethod: target.method,
    capturedGetter: Object.getOwnPropertyDescriptor(target, 'value')!.get!,
  };
};
const state: {
  pid: number;
  threadId: number;
  completed: number;
  errors: string[];
  queuePendingAtCleanup: boolean;
  mocksLiveAtCleanup: boolean;
  mocks?: ReturnType<typeof createMocks>;
} = {
  pid: process.pid,
  threadId,
  completed: 0,
  errors: [],
  queuePendingAtCleanup: false,
  mocksLiveAtCleanup: false,
};
const previous = Reflect.get(fs, marker) as typeof state | undefined;
const sharedFile = new URL('./setup.ts', import.meta.url);

it('keeps native fs usable across reused worker files', async () => {
  expect(load('fs')).toBe(fs);
  expect(load('node:fs')).toBe(fs);
  expect(fs.promises).toBe(fsPromises);
  expect(load('fs/promises')).toBe(fsPromises);
  expect(load('node:fs/promises')).toBe(fsPromises);

  if (previous) {
    expect(previous.pid).toBe(process.pid);
    expect(previous.threadId).toBe(threadId);
    expect(previous.queuePendingAtCleanup).toBe(true);
    // Both native close entry points now call the first file's graceful-fs patch.
    fs.closeSync(fs.openSync(sharedFile, 'r'));
    await new Promise<void>((resolve, reject) => {
      fs.open(sharedFile, 'r', (error, fd) => {
        if (error) return reject(error);
        fs.close(fd, (closeError) =>
          closeError ? reject(closeError) : resolve(),
        );
      });
    });
    await rs.waitUntil(() => previous.completed === 2);
    expect(previous.errors).toEqual([]);
    expect(Reflect.get(fs, Symbol.for('graceful-fs.queue'))).toHaveLength(0);
    console.log('VM_NATIVE_FS_RETRY_QUEUE_DRAINED');
    console.log('VM_NATIVE_FS_REUSED_AND_CLEAN');
  } else {
    const closeBefore = fs.closeSync;
    let attempts = 0;
    const originalOpen = fs.open;
    rs.spyOn(fs, 'open').mockImplementation((...args) => {
      if (String(args[0]) !== String(sharedFile)) {
        return Reflect.apply(originalOpen, fs, args);
      }
      const callback = args.at(-1);
      if (typeof callback !== 'function')
        throw new Error('missing open callback');
      callback(
        Object.assign(new Error('retry queued open'), {
          code: attempts++ % 2 === 0 ? 'EMFILE' : 'ENFILE',
        }),
        -1,
      );
    });
    // Resolve the dependency through fs-extra, which is already an e2e dependency.
    const graceful: typeof fs = load(
      createRequire(load.resolve('fs-extra')).resolve('graceful-fs'),
    );
    afterAll(() => {
      for (let request = 0; request < 2; request++) {
        graceful.open(sharedFile, 'r', (error, fd) => {
          if (error) {
            state.errors.push(error.code ?? error.message);
            return;
          }
          fs.close(fd, (closeError) => {
            if (closeError) state.errors.push(closeError.message);
            state.completed++;
          });
        });
      }
      expect(state.completed).toBe(0);
      expect(Reflect.get(fs, Symbol.for('graceful-fs.queue'))).toHaveLength(2);
    });
    registerFileCleanup(() => {
      expect(state.completed).toBe(0);
      expect(Reflect.get(fs, Symbol.for('graceful-fs.queue'))).toHaveLength(2);
      state.queuePendingAtCleanup = true;
    });
    expect(fs.closeSync).not.toBe(closeBefore);
    console.log('VM_NATIVE_FS_GRACEFUL_INSTALLED');
  }
});

it('resets retained mocks and restores method and getter spies at file end', () => {
  if (!previous) {
    const mocks = createMocks();
    state.mocks = mocks;
    registerFileCleanup(() => {
      expect(mocks.target.method()).toBe('mocked method');
      expect(mocks.target.value).toBe('mocked getter');
      expect(mocks.fn).toHaveBeenCalledTimes(1);
      state.mocksLiveAtCleanup = true;
    });
    return;
  }
  expect(previous.mocksLiveAtCleanup).toBe(true);
  const mocks = previous.mocks!;
  expect(rs.isMockFunction(mocks.target.method)).toBe(false);
  expect(mocks.target.method()).toBe('original method');
  expect(mocks.target.value).toBe('original getter');
  expect(mocks.method).not.toHaveBeenCalled();
  expect(mocks.getter).not.toHaveBeenCalled();
  expect(mocks.fn).not.toHaveBeenCalled();
  expect(mocks.fn()).toBe('initial implementation');
  expect(mocks.fn()).toBe('initial implementation');
  expect(mocks.capturedMethod()).toBe('original method');
  expect(mocks.capturedGetter()).toBe('original getter');
  console.log('VM_FILE_MOCKS_RESET_AND_RESTORED');
});

it('restores spies before the next file imports builtins', () => {
  if (!previous) return;
  expect(rs.isMockFunction(fs.linkSync)).toBe(false);
  expect(rs.isMockFunction(fsPromises.link)).toBe(false);
  expect(rs.isMockFunction(linkSync)).toBe(false);
  expect(rs.isMockFunction(link)).toBe(false);
  console.log('VM_NATIVE_FS_SPIES_RESTORED');
});

it('resets spies captured by lazy native rm and cp implementations', async () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'rstest-vm-captured-fs-'));
  registerFileCleanup(() =>
    fs.rmSync(directory, { recursive: true, force: true }),
  );
  const removed = join(directory, 'removed');
  const source = join(directory, 'source');
  const destination = join(directory, 'destination');
  fs.writeFileSync(removed, 'remove');
  fs.writeFileSync(source, 'copy');
  if (!previous) {
    const error = Object.assign(new Error('captured fs spy'), {
      code: 'EACCES',
    });
    rs.spyOn(fs, 'unlink').mockImplementation((_path, callback) =>
      callback(error),
    );
    rs.spyOn(fsPromises, 'copyFile').mockRejectedValue(error);
  }

  const removeError = await new Promise<NodeJS.ErrnoException | null>(
    (resolve) => {
      fs.rm(removed, (error) => resolve(error));
    },
  );
  expect(removeError?.code ?? null).toBe(previous ? null : 'EACCES');
  expect(fs.existsSync(removed)).toBe(!previous);
  if (previous) {
    await fsPromises.cp(source, destination);
    expect(fs.readFileSync(destination, 'utf8')).toBe('copy');
    console.log('VM_NATIVE_FS_CAPTURED_SPIES_RESET');
  } else {
    await expect(fsPromises.cp(source, destination)).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(fs.existsSync(destination)).toBe(false);
  }
});

afterAll(() => {
  Reflect.set(fs, marker, state);
  // File disposal must not depend on public utility methods remaining untouched.
  rs.spyOn(rs, 'resetAllMocks').mockReturnValue(rs);
  rs.spyOn(rs, 'restoreAllMocks').mockReturnValue(rs);
  rs.spyOn(fs, 'linkSync').mockImplementation(() => undefined);
  rs.spyOn(fsPromises, 'link').mockResolvedValue(undefined);
  syncBuiltinESMExports();
});

if (process.env.RSTEST_VM_FAILURE === 'cleanup') {
  registerFileCleanup(() => {
    throw new Error('VM_NATIVE_FS_EXPECTED_CLEANUP_FAILURE');
  });
}

if (!previous && process.env.RSTEST_VM_FAILURE === 'test') {
  it('still disposes mocks after a failing test', () => {
    throw new Error('VM_NATIVE_FS_EXPECTED_TEST_FAILURE');
  });
}
