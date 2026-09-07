import { resolveObjectURL } from 'node:buffer';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { promisify } from 'node:util';
import { afterAll, expect } from '@rstest/core';

if (process.env.RSTEST_VM_PROMISIFIED_TIMERS_STARTED) {
  expect(process.env.RSTEST_VM_PROMISIFIED_TIMERS_CANCELLED).toBe('2');
  expect(process.env.RSTEST_VM_PROMISIFIED_TIMER_ERROR).toBe(
    'AbortError:ABORT_ERR',
  );
  expect(process.env.RSTEST_VM_PROMISIFIED_TIMER_FULFILLED).toBeUndefined();
  console.log('VM_PROMISIFIED_TIMERS_CANCELLED');
}
process.env.RSTEST_VM_PROMISIFIED_TIMERS_CANCELLED = '0';

afterAll(() => {
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
});

const previousObjectURL = process.env.RSTEST_VM_PREVIOUS_OBJECT_URL;
if (previousObjectURL) {
  expect(resolveObjectURL(previousObjectURL)).toBeUndefined();
  console.log('VM_OBJECT_URL_REVOKED');
}
const objectURL = URL.createObjectURL(new Blob(['file-scoped']));
expect(resolveObjectURL(objectURL)).toBeDefined();
process.env.RSTEST_VM_PREVIOUS_OBJECT_URL = objectURL;

const setupGlobal = globalThis as typeof globalThis & {
  __RSTEST_VM_SETUP_COUNT__?: number;
};

setupGlobal.__RSTEST_VM_SETUP_COUNT__ =
  (setupGlobal.__RSTEST_VM_SETUP_COUNT__ ?? 0) + 1;
console.log('VM_SETUP_FILE');
