import { GLOBAL_EXPECT } from '@vitest/expect';
import { config as chaiConfig, util } from 'chai';
import {
  createExpect,
  createFileExpect,
  setupChaiConfig,
  registerElementExpect,
} from '../../../src/runtime/api/expect';
import {
  type FileContext,
  setFileContext,
} from '../../../src/runtime/fileContext';
import { setRealTimers } from '../../../src/runtime/util';
import type { TestCase, WorkerState } from '../../../src/types';
import { toNativePath } from '../../../src/utils/helper';

const fakeTest = (name: string, concurrent = false) =>
  ({ name, concurrent }) as unknown as TestCase;
type ElementExpect = {
  element: (locator: unknown) => unknown;
};

// Publish a fake running file: the singleton resolves the current test and
// worker state through this context at call time, as production does.
const publishFile = (
  testPath: string,
  currentTestName: string,
  concurrent = false,
) => {
  setFileContext({
    workerState: { testPath, runtimeConfig: {} } as WorkerState,
    testRunner: {
      getCurrentTest: () => fakeTest(currentTestName, concurrent),
      getCurrentTimeoutContext: () => undefined,
    },
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
  registerElementExpect(() => undefined);
});

it('resets omitted Chai options before applying the next project config', () => {
  setupChaiConfig({ showDiff: false, truncateThreshold: 0 });
  setupChaiConfig({ showDiff: true });

  expect(chaiConfig.showDiff).toBe(true);
  expect(chaiConfig.truncateThreshold).toBe(40);
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
    // `getState().testPath` is normalized to OS-native separators (#1465).
    expect(captured.getState().testPath).toBe(toNativePath('/f2'));
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

    expect(fileExpect.getState().testPath).toBe(toNativePath('/f2'));
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

  it('does not use the shared test deadline for concurrent tests', () => {
    let timeout: number | undefined;
    publishFile('/f2', 't2', true);
    const fileExpect = createFileExpect(() => {});
    registerElementExpect((_locator, options) => {
      timeout = options.getTimeout();
      return {};
    });

    (fileExpect as typeof fileExpect & ElementExpect).element('locator');

    expect(timeout).toBe(1000);
  });
});

describe('expect.element timeout', () => {
  afterEach(() => {
    registerElementExpect(() => undefined);
  });

  it('caps the element timeout at the remaining test timeout', () => {
    let timeout: number | undefined;
    const startTime = Date.now() - 200;
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 1000 } } },
        }) as WorkerState,
      getCurrentTest: () =>
        ({ timeout: 1000, startTime }) as unknown as TestCase,
    });
    registerElementExpect((_locator, options) => {
      timeout = options.getTimeout();
      return {};
    });

    (localExpect as typeof localExpect & ElementExpect).element('locator');

    expect(timeout).toBeGreaterThan(500);
    expect(timeout).toBeLessThanOrEqual(850);
  });

  it('uses the poll timeout when the test timeout is disabled', () => {
    let timeout: number | undefined;
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 5000 } } },
        }) as WorkerState,
      getCurrentTest: () =>
        ({ timeout: 0, startTime: Date.now() }) as unknown as TestCase,
    });
    registerElementExpect((_locator, options) => {
      timeout = options.getTimeout();
      return {};
    });

    (localExpect as typeof localExpect & ElementExpect).element('locator');

    expect(timeout).toBe(5000);
  });

  it('caps the element timeout at the configured poll timeout', () => {
    let timeout: number | undefined;
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 5000 } } },
        }) as WorkerState,
      getCurrentTest: () =>
        ({
          timeout: 10000,
          startTime: Date.now() - 200,
        }) as unknown as TestCase,
    });
    registerElementExpect((_locator, options) => {
      timeout = options.getTimeout();
      return {};
    });

    (localExpect as typeof localExpect & ElementExpect).element('locator');

    expect(timeout).toBe(5000);
  });

  it('uses the poll timeout when no test context is available', () => {
    let timeout: number | undefined;
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 5000 } } },
        }) as WorkerState,
      getCurrentTest: () => undefined,
    });
    registerElementExpect((_locator, options) => {
      timeout = options.getTimeout();
      return {};
    });

    (localExpect as typeof localExpect & ElementExpect).element('locator');

    expect(timeout).toBe(5000);
  });

  it('keeps short test timeouts usable', () => {
    let timeout: number | undefined;
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 5000 } } },
        }) as WorkerState,
      getCurrentTest: () =>
        ({
          timeout: 100,
          startTime: Date.now(),
        }) as unknown as TestCase,
    });
    registerElementExpect((_locator, options) => {
      timeout = options.getTimeout();
      return {};
    });

    (localExpect as typeof localExpect & ElementExpect).element('locator');

    expect(timeout).toBeGreaterThan(1);
    expect(timeout).toBeLessThanOrEqual(100);
  });

  it('resolves the timeout when the matcher starts', () => {
    let getTimeout: (() => number) | undefined;
    const currentTest = {
      timeout: 1000,
      startTime: Date.now() - 200,
    } as unknown as TestCase;
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 5000 } } },
        }) as WorkerState,
      getCurrentTest: () => currentTest,
    });
    registerElementExpect((_locator, options) => {
      getTimeout = options.getTimeout;
      return {};
    });

    (localExpect as typeof localExpect & ElementExpect).element('locator');
    currentTest.startTime = Date.now() - 900;

    expect(getTimeout).toBeDefined();
    if (!getTimeout) {
      throw new Error('element timeout resolver was not captured');
    }
    expect(getTimeout()).toBeLessThan(200);
  });

  it('caps an implicit poll timeout at the remaining test timeout', async () => {
    setRealTimers();
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 5000 } } },
        }) as WorkerState,
      getCurrentTest: () =>
        ({
          timeout: 1000,
          startTime: Date.now() - 1000,
        }) as unknown as TestCase,
    });

    let error: unknown;
    try {
      await localExpect
        .poll(() => {
          throw new Error('not ready');
        })
        .toBe(true);
    } catch (caught) {
      error = caught;
    }

    expect(error).toHaveProperty('message', 'Matcher did not succeed in 1ms');
  });

  it('resolves an implicit poll timeout when the matcher starts', async () => {
    setRealTimers();
    const currentTest = {
      timeout: 1000,
      startTime: Date.now(),
    } as unknown as TestCase;
    const localExpect = createExpect({
      getWorkerState: () =>
        ({
          runtimeConfig: { expect: { poll: { timeout: 5000 } } },
        }) as WorkerState,
      getCurrentTest: () => currentTest,
    });
    const pending = localExpect.poll(() => {
      throw new Error('not ready');
    });
    currentTest.startTime = Date.now() - 1000;

    let error: unknown;
    try {
      await pending.toBe(true);
    } catch (caught) {
      error = caught;
    }

    expect(error).toHaveProperty('message', 'Matcher did not succeed in 1ms');
  });
});
