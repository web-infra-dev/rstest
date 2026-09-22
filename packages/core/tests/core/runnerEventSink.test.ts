import {
  createRunnerEventSink,
  drainReporterHooks,
  RUNNER_EVENT_SINK_MATCHES_RPC,
  sinkToRuntimeRpc,
} from '../../src/core/runnerEventSink';
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
