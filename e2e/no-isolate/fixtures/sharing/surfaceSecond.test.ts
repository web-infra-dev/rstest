// Drives the ENTIRE `@rstest/core` surface through one persisted helper
// (surfaceHelper.ts) from a NON-FIRST file, so every captured API must late-bind
// to THIS file rather than the first file's torn-down context:
//   - `test.extend(...)`        → registers against this file's runner
//   - file-level hooks          → run for this file (beforeAll/beforeEach/afterEach/afterAll)
//   - `test.describe(...)`      → collects into this file's tree
//   - `expect` / `expect.poll`  → resolve this file's test context
//   - `rstest.fn` + clearMocks  → the mock registry being cleared is this file's
//   - `onTestFinished(...)`     → defers onto this file's runner, fires at test end
// See https://github.com/web-infra-dev/rstest/issues/1376.
import { expect, onTestFinished, rstest, test } from './surfaceHelper';

const mock = rstest.fn();

let beforeAllRan = false;
let beforeEachRuns = 0;
let afterEachRuns = 0;
let onTestFinishedRan = false;

test.beforeAll(() => {
  beforeAllRan = true;
});
test.beforeEach(() => {
  beforeEachRuns += 1;
});
test.afterEach(() => {
  afterEachRuns += 1;
});
test.afterAll(() => {
  // Read by surfaceThird.test.ts to prove the shared afterAll ran for THIS file.
  (globalThis as Record<string, any>).__rstestSurfaceAfterAll = true;
});

test.describe('surfaceSecond: full shared surface binds to this file', () => {
  test('hooks + describe + extended test run for this file', () => {
    expect(beforeAllRan).toBe(true);
    expect(beforeEachRuns).toBe(1);
    mock();
    expect(mock.mock.calls.length).toBe(1);
    // A shared `onTestFinished` frozen to the first file's runner would throw
    // here ("can only be called inside a test"); registering cleanly and firing
    // proves it late-binds to this file's runner.
    onTestFinished(() => {
      onTestFinishedRan = true;
    });
    expect(onTestFinishedRan).toBe(false);
  });

  test('clearMocks reset the shared-helper mock between tests', () => {
    // `clearMocks: true` clears the CURRENT file's registry before each test;
    // the mock came through the persisted `rstest` reference, so this proves the
    // reference resolved this file's utilities (not the first file's).
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
