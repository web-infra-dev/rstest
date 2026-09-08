import { resolveObjectURL } from 'node:buffer';
import { appendFileSync } from 'node:fs';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { promisify } from 'node:util';
import { afterAll, expect, registerFileCleanup, rs } from '@rstest/core';

if (process.env.RSTEST_VM_PROMISIFIED_TIMERS_STARTED) {
  expect(process.env.RSTEST_VM_PROMISIFIED_TIMERS_CANCELLED).toBe('2');
  expect(process.env.RSTEST_VM_PROMISIFIED_TIMER_ERROR).toBe(
    'AbortError:ABORT_ERR',
  );
  expect(process.env.RSTEST_VM_PROMISIFIED_TIMER_FULFILLED).toBeUndefined();
  console.log('VM_PROMISIFIED_TIMERS_CANCELLED');
}
process.env.RSTEST_VM_PROMISIFIED_TIMERS_CANCELLED = '0';

afterAll(async () => {
  process.env.RSTEST_VM_PROMISIFIED_TIMERS_STARTED = 'true';
  // Both entry points must be cancelled before the next file starts, without
  // depending on whether a short delay happens to expire during teardown.
  for (const timer of [setTimeout, nodeSetTimeout]) {
    void promisify(timer)(60_000).then(
      () => {
        process.env.RSTEST_VM_PROMISIFIED_TIMER_FULFILLED = 'true';
      },
      (error) => {
        process.env.RSTEST_VM_PROMISIFIED_TIMER_ERROR = `${error.name}:${error.code}`;
        process.env.RSTEST_VM_PROMISIFIED_TIMERS_CANCELLED = String(
          Number(process.env.RSTEST_VM_PROMISIFIED_TIMERS_CANCELLED) + 1,
        );
      },
    );
  }
  const marker = process.env.RSTEST_VM_WAIT_MARKER;
  if (!marker) throw new Error('RSTEST_VM_WAIT_MARKER is required');
  const options = { timeout: 60_000, interval: 10_000 };
  const waits = [
    rs.waitUntil(() => false, options),
    rs.waitFor(() => {
      throw new Error('still waiting');
    }, options),
  ];
  for (const wait of waits) {
    void wait
      .then(
        () => {
          appendFileSync(marker, 'fulfilled\n');
          setTimeout(() => appendFileSync(marker, 'late timer\n'), 10);
        },
        () => appendFileSync(marker, 'rejected\n'),
      )
      .finally(() => appendFileSync(marker, 'finally\n'));
  }
  await Promise.resolve();
});

const previousObjectURL = process.env.RSTEST_VM_PREVIOUS_OBJECT_URL;
if (previousObjectURL) {
  expect(resolveObjectURL(previousObjectURL)).toBeUndefined();
  console.log('VM_OBJECT_URL_REVOKED');
}
const objectURL = URL.createObjectURL(new Blob(['file-scoped']));
expect(resolveObjectURL(objectURL)).toBeDefined();
process.env.RSTEST_VM_PREVIOUS_OBJECT_URL = objectURL;

if (process.env.RSTEST_VM_FILE_CLEANUP_FAIL === 'true') {
  registerFileCleanup(() => {
    throw new Error('VM_FILE_CLEANUP_FAILURE');
  });
}
registerFileCleanup(async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(resolveObjectURL(objectURL)).toBeDefined();
  const marker = process.env.RSTEST_VM_FILE_CLEANUP_MARKER;
  if (!marker) throw new Error('RSTEST_VM_FILE_CLEANUP_MARKER is required');
  appendFileSync(marker, 'cleaned\n');
});

const setupGlobal = globalThis as typeof globalThis & {
  __RSTEST_VM_SETUP_COUNT__?: number;
};

setupGlobal.__RSTEST_VM_SETUP_COUNT__ =
  (setupGlobal.__RSTEST_VM_SETUP_COUNT__ ?? 0) + 1;
console.log('VM_SETUP_FILE');
