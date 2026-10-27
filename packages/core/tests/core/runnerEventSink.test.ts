import {
  createRunnerEventSink,
  drainReporterHooks,
  RUNNER_EVENT_SINK_MATCHES_RPC,
  sinkToRuntimeRpc,
} from '../../src/core/execution/runnerEventSink';
import { TestStateManager } from '../../src/core/execution/stateManager';
import type {
  InternalContext,
  InternalProjectContext,
  RawTestFileResult,
  RawUserConsoleLog,
  TestCaseInfo,
  TestFileResult,
} from '../../src/types';

const makeContext = (
  overrides: {
    onConsoleLog?: (content: string, type: string) => boolean | void;
    disableConsoleIntercept?: boolean;
    resolveSnapshotPath?: (testPath: string, snapExtension: string) => string;
    failedCount?: number;
  } = {},
) => {
  const calls = {
    stateFileResult: [] as unknown[],
    snapshotAdd: [] as unknown[],
    reporterFileResult: [] as unknown[],
    reporterConsole: [] as unknown[],
  };
  const reporter = {
    onTestFileResult: (r: unknown) => {
      calls.reporterFileResult.push(r);
    },
    onUserConsoleLog: (log: unknown) => {
      calls.reporterConsole.push(log);
    },
  };
  const context = {
    rootPath: '/root',
    reporters: [reporter],
    stateManager: {
      onTestCaseStart: () => {},
      onTestCaseResult: () => {},
      onTestFileStart: () => {},
      onTestFileResult: (r: unknown) => {
        calls.stateFileResult.push(r);
      },
      getCountOfFailedTests: () => overrides.failedCount ?? 0,
    },
    snapshotManager: {
      add: (r: unknown) => {
        calls.snapshotAdd.push(r);
      },
    },
  } as unknown as InternalContext;

  const projectConfig = {
    onConsoleLog: overrides.onConsoleLog,
    disableConsoleIntercept: overrides.disableConsoleIntercept ?? false,
    resolveSnapshotPath: overrides.resolveSnapshotPath,
  } as unknown as InternalProjectContext['normalizedConfig'];

  return { context, projectConfig, calls };
};

const log = (content: string): RawUserConsoleLog => ({
  content,
  name: 'log',
  testPath: '/root/a.test.ts',
  project: 'test',
  type: 'stdout',
});

const caseInfo: TestCaseInfo = {
  testId: 'case:a',
  testPath: '/a.test.ts',
  relativeTestPath: 'a.test.ts',
  project: 'test',
  name: 'case',
  fullName: 'suite > case',
  parentNames: ['suite'],
  type: 'case',
  runMode: 'run',
};

const fileResult: TestFileResult = {
  testId: 'file:/a.test.ts',
  testPath: '/a.test.ts',
  relativeTestPath: 'a.test.ts',
  project: 'test',
  name: '',
  fullName: '',
  status: 'passed',
  results: [],
  summary: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, flaky: 0 },
};

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe('createRunnerEventSink', () => {
  it('defers reporter case-result handlers without allowing file results to overtake them', async () => {
    const { context, projectConfig } = makeContext();
    const onStateCaseResult = rs.fn();
    (
      context.stateManager as unknown as {
        onTestCaseResult: typeof onStateCaseResult;
      }
    ).onTestCaseResult = onStateCaseResult;
    const order: string[] = [];
    let finishCaseResult!: () => void;
    let markCaseResultStarted!: () => void;
    const caseResultStarted = new Promise<void>((resolve) => {
      markCaseResultStarted = resolve;
    });
    context.reporters.push({
      onTestCaseResult: async () => {
        order.push('case-start');
        markCaseResultStarted();
        await new Promise<void>((resolve) => {
          finishCaseResult = resolve;
        });
        order.push('case-end');
      },
      onTestFileResult: () => {
        order.push('file');
      },
    });
    const sink = createRunnerEventSink(context, projectConfig);
    const result = {
      testId: 'case',
      testPath: '/a.test.ts',
      project: 'test',
      name: 'case',
      status: 'passed' as const,
      errors: [],
    };

    await sink.onTestCaseResult(result);
    expect(onStateCaseResult).toHaveBeenCalledWith({
      ...result,
      fullName: 'case',
      relativeTestPath: '../a.test.ts',
    });
    await caseResultStarted;
    expect(order).toEqual(['case-start']);

    const fileResult = sink.onTestFileResult({
      testId: '/a.test.ts',
      project: 'test',
      testPath: '/a.test.ts',
      name: '/a.test.ts',
      status: 'passed',
      errors: [],
      results: [result],
    });
    await Promise.resolve();
    expect(order).toEqual(['case-start']);

    finishCaseResult();
    await fileResult;
    expect(order).toEqual(['case-start', 'case-end', 'file']);
  });

  it('clears discarded failures and drops reporter events still waiting for run start', async () => {
    const { context, projectConfig } = makeContext();
    context.stateManager = new TestStateManager();
    let open!: () => void;
    const opened = new Promise<Error | undefined>((resolve) => {
      open = () => resolve(undefined);
    });
    context.openReporterRun = () => opened;
    const onTestCaseResult = rs.fn();
    context.reporters.push({ onTestCaseResult });
    const sink = createRunnerEventSink(context, projectConfig);
    const first = sinkToRuntimeRpc(sink);
    const second = sinkToRuntimeRpc(sink);
    const failure = {
      testId: 'case',
      testPath: '/a.test.ts',
      project: 'test',
      name: 'case',
      status: 'failed' as const,
      errors: [],
    };
    const delivered = first.onTestCaseResult(failure);
    const success = {
      ...failure,
      testPath: '/b.test.ts',
      status: 'passed' as const,
    };
    const otherDelivered = second.onTestCaseResult(success);
    expect(await first.getCountOfFailedTests()).toBe(1);
    expect(await second.getCountOfFailedTests()).toBe(1);
    sink.discardAttempt('/a.test.ts');
    expect(await first.getCountOfFailedTests()).toBe(0);
    expect(await second.getCountOfFailedTests()).toBe(0);
    open();
    await Promise.all([delivered, otherDelivered]);
    await Promise.all([
      sink.onTestFileResult({
        testId: '/a.test.ts',
        project: 'test',
        testPath: '/a.test.ts',
        name: '/a.test.ts',
        status: 'passed',
        errors: [],
        results: [],
      }),
      sink.onTestFileResult({
        testId: '/b.test.ts',
        project: 'test',
        testPath: '/b.test.ts',
        name: '/b.test.ts',
        status: 'passed',
        errors: [],
        results: [success],
      }),
    ]);
    expect(onTestCaseResult).toHaveBeenCalledExactlyOnceWith({
      ...success,
      fullName: 'case',
      relativeTestPath: '../b.test.ts',
    });
  });

  it('starts arriving hooks immediately and joins them before the file result', async () => {
    const { context, projectConfig } = makeContext();
    const start = gate();
    const result = gate();
    const events: string[] = [];
    context.reporters = [
      {
        async onTestCaseStart() {
          events.push('start:enter');
          await start.promise;
          events.push('start:exit');
        },
        async onTestCaseResult() {
          events.push('result:enter');
          await result.promise;
          events.push('result:exit');
        },
        onTestFileResult() {
          events.push('file');
        },
      },
    ];
    const sink = createRunnerEventSink(context, projectConfig);
    const startHook = sink.onTestCaseStart(caseInfo);
    const resultHook = sink.onTestCaseResult({ ...caseInfo, status: 'passed' });
    const fileHook = sink.onTestFileResult(fileResult);
    expect(events).toEqual(['start:enter', 'result:enter']);
    result.release();
    await resultHook;
    expect(events).toEqual(['start:enter', 'result:enter', 'result:exit']);
    start.release();
    await Promise.all([startHook, fileHook]);
    expect(events).toEqual([
      'start:enter',
      'result:enter',
      'result:exit',
      'start:exit',
      'file',
    ]);
    expect(await drainReporterHooks(context)).toEqual([]);
  });

  it('keeps project/file joins separate and drains hooks without a file result', async () => {
    const { context, projectConfig } = makeContext();
    const consoleGate = gate();
    let fileFinished = false;
    let runFinished = false;
    context.reporters = [
      {
        onUserConsoleLog: () => consoleGate.promise,
        onTestFileResult() {
          fileFinished = true;
        },
      },
    ];
    const sink = createRunnerEventSink(context, projectConfig);
    const consoleHook = sink.onConsoleLog(log('pending'));
    await sink.onTestFileResult({ ...fileResult, project: 'another-project' });
    expect(fileFinished).toBe(true);
    const run = drainReporterHooks(context).then((errors) => {
      runFinished = true;
      return errors;
    });
    await Promise.resolve();
    expect(runFinished).toBe(false);
    consoleGate.release();
    await consoleHook;
    expect(await run).toEqual([]);
    expect(runFinished).toBe(true);
  });

  it('records sync and async failures with reporter and hook attribution', async () => {
    const { context, projectConfig } = makeContext();
    class BrokenReporter {
      onTestCaseStart() {
        throw new Error('sync rejection');
      }
      async onTestCaseResult() {
        throw new Error('async rejection');
      }
    }
    context.reporters = [new BrokenReporter()];
    const sink = createRunnerEventSink(context, projectConfig);
    await sink.onTestCaseStart(caseInfo);
    await sink.onTestCaseResult({ ...caseInfo, status: 'passed' });
    const errors = await drainReporterHooks(context);
    expect(errors.map((error) => error.message)).toEqual([
      'Reporter BrokenReporter (#1) onTestCaseStart failed: sync rejection',
      'Reporter BrokenReporter (#1) onTestCaseResult failed: async rejection',
    ]);
    expect(await drainReporterHooks(context)).toEqual([]);
  });

  it('exposes the compile-time drift guard against RuntimeRPC', () => {
    expect(RUNNER_EVENT_SINK_MATCHES_RPC).toBe(true);
  });

  it('onTestFileResult feeds stateManager, reporters, and snapshotManager', async () => {
    const { context, projectConfig, calls } = makeContext();
    const sink = createRunnerEventSink(context, projectConfig);
    const result: RawTestFileResult = {
      testId: 'file:/root/a.test.ts',
      testPath: '/root/a.test.ts',
      project: 'test',
      name: '',
      status: 'passed',
      snapshotResult: {
        added: 1,
        fileDeleted: false,
        filepath: '/root/a.test.ts.snap',
        matched: 0,
        unchecked: 0,
        uncheckedKeys: [],
        unmatched: 0,
        updated: 0,
      },
      results: [],
    };

    const enriched = await sink.onTestFileResult(result);

    expect(calls.stateFileResult).toEqual([enriched]);
    expect(calls.reporterFileResult).toEqual([enriched]);
    expect(calls.snapshotAdd).toEqual([result.snapshotResult]);
  });

  it('opens the reporter run ahead of the first file start and of a console log', async () => {
    const { context, projectConfig, calls } = makeContext();
    const order: string[] = [];
    context.openReporterRun = async () => {
      order.push('open');
      return undefined;
    };
    context.reporters.push({
      onTestFileStart: () => {
        order.push('file');
      },
    });
    const sink = createRunnerEventSink(context, projectConfig);

    await sink.onTestFileStart({
      testId: '/a.test.ts',
      testPath: '/a.test.ts',
      project: 'test',
      tests: [],
    });
    await sink.onConsoleLog(log('hello'));

    expect(order).toEqual(['open', 'file', 'open']);
    expect(calls.reporterConsole).toEqual([
      { ...log('hello'), relativeTestPath: 'a.test.ts' },
    ]);
  });

  it('onConsoleLog honors the per-project onConsoleLog filter', async () => {
    const { context, projectConfig, calls } = makeContext({
      onConsoleLog: (content) => !content.includes('drop'),
    });
    const sink = createRunnerEventSink(context, projectConfig);

    await sink.onConsoleLog(log('keep me'));
    await sink.onConsoleLog(log('drop me'));

    expect(calls.reporterConsole).toEqual([
      { ...log('keep me'), relativeTestPath: 'a.test.ts' },
    ]);
  });

  it('onConsoleLog is a no-op when disableConsoleIntercept is set', async () => {
    const { context, projectConfig, calls } = makeContext({
      disableConsoleIntercept: true,
    });
    const sink = createRunnerEventSink(context, projectConfig);

    await sink.onConsoleLog(log('anything'));

    expect(calls.reporterConsole).toEqual([]);
  });

  it('resolveSnapshotPath uses the per-project resolver', () => {
    const { context, projectConfig } = makeContext({
      resolveSnapshotPath: (testPath, ext) => `/custom/${testPath}${ext}`,
    });
    const sink = createRunnerEventSink(context, projectConfig);

    expect(sink.resolveSnapshotPath('/a/b.test.ts')).toBe(
      '/custom//a/b.test.ts.snap',
    );
  });

  it('sinkToRuntimeRpc exposes the runner RPC surface without getAssetsByEntry/onTestFileResult', () => {
    const { context, projectConfig } = makeContext();
    const rpc = sinkToRuntimeRpc(createRunnerEventSink(context, projectConfig));

    expect(typeof rpc.onTestCaseStart).toBe('function');
    expect(typeof rpc.getCountOfFailedTests).toBe('function');
    expect(typeof rpc.resolveSnapshotPath).toBe('function');
    expect('getAssetsByEntry' in rpc).toBe(false);
    expect('onTestFileResult' in rpc).toBe(false);
  });
});
