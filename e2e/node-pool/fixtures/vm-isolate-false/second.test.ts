import { appendFileSync } from 'node:fs';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { threadId } from 'node:worker_threads';
import { expect, it } from '@rstest/core';
import { getCount, increment } from './shared';
import { workerTest } from './workerFixture';

const FILE_MARKER = '__RSTEST_VM_FILE_MARKER__';

workerTest('isolates the second file', ({ workerValue }) => {
  const fileGlobal = globalThis as typeof globalThis & {
    __RSTEST_VM_SETUP_COUNT__?: number;
    [FILE_MARKER]?: string;
  };

  expect(workerValue).toBe('worker');
  expect(fileGlobal.__RSTEST_VM_SETUP_COUNT__).toBe(1);
  expect(fileGlobal[FILE_MARKER]).toBeUndefined();
  expect(getCount()).toBe(0);
  expect(
    (Promise as typeof Promise & { __RSTEST_VM_FILE__?: string })
      .__RSTEST_VM_FILE__,
  ).toBeUndefined();

  fileGlobal[FILE_MARKER] = 'second';
  (
    Promise as typeof Promise & { __RSTEST_VM_FILE__?: string }
  ).__RSTEST_VM_FILE__ = 'second';
  increment();
  expect(getCount()).toBe(1);
  console.log(`VM_THREAD_ID:${threadId}`);
});

it('re-homes host fetch errors into the VM realm', async () => {
  await expect(fetch('not a url')).rejects.toThrow(TypeError);
});

it('keeps native response bodies usable across the realm boundary', async () => {
  const response = await fetch('data:application/json,%7B%22value%22%3A1%7D');
  expect(response).toBeInstanceOf(Response);
  const body = response.json();
  expect(body).not.toBeInstanceOf(Promise);
  const json = await body;
  expect(json).toEqual({ value: 1 });
  expect(Object.getPrototypeOf(json)).not.toBe(Object.prototype);
  const invalidResponse = await fetch('data:application/json,invalid');
  await expect(invalidResponse.json()).rejects.toMatchObject({
    name: 'SyntaxError',
  });
});

it('preserves native structuredClone failure metadata', () => {
  expect(() => structuredClone(() => {})).toThrow(
    expect.objectContaining({ name: 'DataCloneError', code: 25 }),
  );
  try {
    structuredClone(() => {});
  } catch (error) {
    expect(error).toBeInstanceOf(DOMException);
    expect(error).not.toBeInstanceOf(Error);
  }
});

it('keeps process guards active during VM cleanup', () => {
  const marker = process.env.RSTEST_VM_GUARD_MARKER;
  if (!marker) {
    throw new Error('RSTEST_VM_GUARD_MARKER is required');
  }

  void setTimeoutPromise(60_000).catch(() => {
    try {
      process.kill(process.pid, 'SIGCONT');
      appendFileSync(marker, 'unguarded\n');
    } catch {
      appendFileSync(marker, 'guarded\n');
    }
  });
});
