import {
  createRunnerEventSink,
  RUNNER_EVENT_SINK_MATCHES_RPC,
  sinkToRuntimeRpc,
} from '../../src/core/runnerEventSink';
import type {
  ProjectContext,
  RstestContext,
  TestFileResult,
  UserConsoleLog,
} from '../../src/types';

const makeContext = (
  overrides: {
    onConsoleLog?: (content: string, type: string) => boolean | void;
    disableConsoleIntercept?: boolean;
    resolveSnapshotPath?: (testPath: string, snapExtension: string) => string;
    failedCount?: number;
  } = {},
) => {
  const calls: Record<string, unknown[]> = {
    stateFileResult: [],
    snapshotAdd: [],
    reporterFileResult: [],
    reporterConsole: [],
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
  } as unknown as RstestContext;

  const projectConfig = {
    onConsoleLog: overrides.onConsoleLog,
    disableConsoleIntercept: overrides.disableConsoleIntercept ?? false,
    resolveSnapshotPath: overrides.resolveSnapshotPath,
  } as unknown as ProjectContext['normalizedConfig'];

  return { context, projectConfig, calls };
};

const log = (content: string): UserConsoleLog =>
  ({ content, type: 'stdout' }) as UserConsoleLog;

describe('createRunnerEventSink', () => {
  it('exposes the compile-time drift guard against RuntimeRPC', () => {
    expect(RUNNER_EVENT_SINK_MATCHES_RPC).toBe(true);
  });

  it('onTestFileResult feeds stateManager, reporters, and snapshotManager', async () => {
    const { context, projectConfig, calls } = makeContext();
    const sink = createRunnerEventSink(context, projectConfig);
    const result = {
      snapshotResult: { added: 1 },
      results: [],
    } as unknown as TestFileResult;

    await sink.onTestFileResult(result);

    expect(calls.stateFileResult).toEqual([result]);
    expect(calls.reporterFileResult).toEqual([result]);
    expect(calls.snapshotAdd).toEqual([result.snapshotResult]);
  });

  it('onConsoleLog honors the per-project onConsoleLog filter', async () => {
    const { context, projectConfig, calls } = makeContext({
      onConsoleLog: (content) => !content.includes('drop'),
    });
    const sink = createRunnerEventSink(context, projectConfig);

    await sink.onConsoleLog(log('keep me'));
    await sink.onConsoleLog(log('drop me'));

    expect(calls.reporterConsole).toEqual([log('keep me')]);
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
