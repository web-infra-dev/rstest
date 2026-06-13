import { GLOBAL_EXPECT } from '@vitest/expect';
import { util } from 'chai';
import {
  createExpect,
  createFileExpect,
} from '../../../src/runtime/api/expect';
import {
  type FileContext,
  setFileContext,
} from '../../../src/runtime/fileContext';
import type { TestCase, WorkerState } from '../../../src/types';

const fakeTest = (name: string) => ({ name }) as unknown as TestCase;

// Publish a fake running file: the singleton resolves the current test and
// worker state through this context at call time, as production does.
const publishFile = (testPath: string, currentTestName: string) => {
  setFileContext({
    workerState: { testPath, runtimeConfig: {} } as WorkerState,
    testRunner: { getCurrentTest: () => fakeTest(currentTestName) },
  } as FileContext);
};

// `createFileExpect` assigns `globalThis[GLOBAL_EXPECT]` — the slot the OUTER
// rstest runtime (running this test file) also owns. Restore it after each
// test so the framework's own per-test expect state handling keeps working.
// @ts-expect-error symbol index
const frameworkExpect = globalThis[GLOBAL_EXPECT];
afterEach(() => {
  // @ts-expect-error symbol index
  globalThis[GLOBAL_EXPECT] = frameworkExpect;
});

/**
 * Regression for https://github.com/web-infra-dev/rstest/issues/1376: the
 * file-level `expect` is a build-once singleton, so a reference (or a
 * value-copied `expect.poll`/`.soft`) captured in a module shared under
 * `isolate: false` always tracks the running file — while the per-test local
 * expect stays a pinned per-test instance.
 */
describe('file-level expect singleton (isolate: false)', () => {
  it('keeps a stable identity across files', () => {
    publishFile('/f1', 't1');
    const first = createFileExpect(() => {});
    publishFile('/f2', 't2');
    const second = createFileExpect(() => {});

    expect(second).toBe(first);
  });

  it('attributes a captured reference to the running file', () => {
    publishFile('/f1', 't1');
    const captured = createFileExpect(() => {});

    // File 2 becomes the running file; the same captured reference must
    // resolve file 2's current test and testPath.
    publishFile('/f2', 't2');
    createFileExpect(() => {});

    const attributed = util.flag(
      captured(1) as unknown as object,
      'vitest-test',
    ) as TestCase;
    expect(attributed.name).toBe('t2');
    expect(captured.getState().testPath).toBe('/f2');
  });

  it('resets per-file bookkeeping between files', () => {
    publishFile('/f1', 't1');
    const fileExpect = createFileExpect(() => {});
    fileExpect.setState({ assertionCalls: 7, isExpectingAssertions: true });

    publishFile('/f2', 't2');
    createFileExpect(() => {});

    expect(fileExpect.getState().assertionCalls).toBe(0);
    expect(fileExpect.getState().isExpectingAssertions).toBe(false);
  });

  it('restores the live testPath getter pinned by a previous test', () => {
    publishFile('/f1', 't1');
    const fileExpect = createFileExpect(() => {});
    // The runner pins `testPath` to a plain value per test (beforeRunTest).
    fileExpect.setState({ testPath: '/f1' });

    publishFile('/f2', 't2');
    createFileExpect(() => {});

    expect(fileExpect.getState().testPath).toBe('/f2');
  });

  it('keeps the per-test local expect pinned (concurrent isolation)', () => {
    publishFile('/f2', 't2');
    const fileExpect = createFileExpect(() => {});
    const localExpect = createExpect({
      getWorkerState: () => ({ testPath: '/f2' }) as WorkerState,
      getCurrentTest: () => fakeTest('local'),
    });

    const attributed = util.flag(
      localExpect(1) as unknown as object,
      'vitest-test',
    ) as TestCase;
    localExpect.setState({ assertionCalls: 3 });

    expect(attributed.name).toBe('local');
    expect(localExpect.getState().assertionCalls).toBe(3);
    // The file singleton's state is untouched by the local expect.
    expect(fileExpect.getState().assertionCalls).toBe(0);
  });
});
