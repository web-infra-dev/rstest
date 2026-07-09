// Consolidated guard for the #1376 family: one shared helper re-exporting the
// WHOLE `@rstest/core` surface by value (extended `test` + `Object.assign` +
// namespace re-exports). The helper is evaluated once per worker, yet every
// captured API must still resolve the CURRENT file when used from a file OTHER
// than the one that first evaluated the helper.
// See https://github.com/web-infra-dev/rstest/issues/1376.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  rstest,
  test as base,
} from '@rstest/core';

const test = Object.assign(base.extend({}), {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
});

/**
 * Drive the entire captured surface from the calling test file. Because the
 * hooks and `describe` are registered while this file's module is executing,
 * they must late-bind to THIS file's runner rather than the file that first
 * evaluated the helper. Called from two peer files (surfaceA/surfaceB) with no
 * assumed order: whichever runs second exercises the late-bind path, and its
 * `beforeAll` proves the earlier file's shared `afterAll` already fired.
 */
export function runSurfaceGuard(label: string): void {
  const g = globalThis as Record<string, any>;
  const mock = rstest.fn();

  let beforeAllRan = false;
  let beforeEachRuns = 0;
  let afterEachRuns = 0;
  let onTestFinishedRan = false;

  test.beforeAll(() => {
    // One worker, `isolate: false`: files run sequentially and share
    // `globalThis`, so every file that started before this one has fully
    // finished — its shared `afterAll` must already have fired. This holds
    // regardless of which order the runner picks the files in.
    const priorStarted = g.__rstestSurfaceStarted ?? 0;
    expect(g.__rstestSurfaceAfterAll ?? 0).toBe(priorStarted);
    g.__rstestSurfaceStarted = priorStarted + 1;
    beforeAllRan = true;
  });
  test.beforeEach(() => {
    beforeEachRuns += 1;
  });
  test.afterEach(() => {
    afterEachRuns += 1;
  });
  test.afterAll(() => {
    g.__rstestSurfaceAfterAll = (g.__rstestSurfaceAfterAll ?? 0) + 1;
  });

  test.describe(`${label}: full shared surface binds to this file`, () => {
    test('hooks + describe + extended test run for this file', () => {
      expect(beforeAllRan).toBe(true);
      expect(beforeEachRuns).toBe(1);
      mock();
      expect(mock.mock.calls.length).toBe(1);
      // A shared `onTestFinished` frozen to another file's runner would throw
      // here ("can only be called inside a test"); registering cleanly and
      // firing proves it late-binds to this file's runner.
      onTestFinished(() => {
        onTestFinishedRan = true;
      });
      expect(onTestFinishedRan).toBe(false);
    });

    test('clearMocks reset the shared-helper mock between tests', () => {
      // `clearMocks: true` clears the CURRENT file's registry before each test;
      // the mock came through the persisted `rstest` reference, so this proves
      // the reference resolved this file's utilities.
      expect(mock.mock.calls.length).toBe(0);
      expect(afterEachRuns).toBe(1);
    });

    test('expect.poll resolves this file test context', async () => {
      let v = 0;
      setTimeout(() => {
        v = 10;
      }, 20);
      await expect.poll(() => v, { interval: 10, timeout: 500 }).toBe(10);
    });

    test('shared onTestFinished fired for this file', () => {
      expect(onTestFinishedRan).toBe(true);
    });
  });
}
