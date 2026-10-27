import { withDefaultConfig } from '../../src/config';
import { createExitCode } from '../../src/core/execution/exitCode';
import {
  finalizeRunCycle,
  notifyReportersOnTestRunEnd,
  notifyReportersOnTestRunStart,
} from '../../src/core/execution/finalizeRun';
import {
  drainReporterHooks,
  recordReporterError,
} from '../../src/core/execution/runnerEventSink';
import { BlobReporter } from '../../src/reporter/blob';
import type {
  InternalContext,
  Reporter,
  TestRunEndPayload,
} from '../../src/types';
import type {
  CoverageMap,
  CoverageMapData,
  CoverageProvider,
} from '../../src/types/coverage';
import { logger, noopTraceSpan } from '../../src/utils';
import { emptyRunEndPayload } from '../reporter/helpers';

describe('finalizeRunCycle', () => {
  it.for(['none', 'pre-start', 'before', 'reporter', 'raw', 'coverage'])(
    'finalizes blob runs with interruption at %s',
    async (phase) => {
      let interrupted = phase === 'before' || phase === 'pre-start';
      const generatedReports: number[] = [];
      const collectedFile = {
        path: '/collected.ts',
        statementMap: {},
        fnMap: {},
        branchMap: {},
        s: { 0: 3 },
        f: {},
        b: {},
      };
      const coverageData: CoverageMapData = { '/collected.ts': collectedFile };
      const coverageMap: CoverageMap = {
        data: {},
        addFileCoverage() {},
        files: () => [],
        fileCoverageFor() {
          throw new Error('No file coverage');
        },
        filter() {
          delete coverageData['/collected.ts'];
        },
        getCoverageSummary() {
          throw new Error('No coverage summary');
        },
        merge() {},
        toJSON: () => coverageData,
      };
      const coverageProvider = {
        init() {},
        collect: () => null,
        async resolveRawCoverage() {
          if (phase === 'raw') {
            await Promise.resolve();
            interrupted = true;
            context.exitCode.raise(130);
          }
          return null;
        },
        createCoverageMap: () => coverageMap,
        generateCoverageForUntestedFiles: async () => [],
        async generateReports() {
          generatedReports.push(1);
          if (phase === 'coverage') context.exitCode.raise(1);
        },
        cleanup() {},
      } satisfies CoverageProvider;
      const blobReporter = Object.create(
        BlobReporter.prototype,
      ) as BlobReporter;
      blobReporter.onTestRunEnd = rs.fn(async (payload) => {
        if (!interrupted) {
          expect(payload.coverage).toEqual({ '/collected.ts': collectedFile });
          expect(coverageData).toEqual({});
        }
        if (phase === 'coverage') {
          expect(payload.status).toBe('failed');
          expect(generatedReports).toEqual([1]);
        }
        if (phase === 'reporter') {
          await Promise.resolve();
          interrupted = true;
          context.exitCode.raise(130);
        }
      });
      const finalizeTrace = rs.fn(async () => {});

      const context = {
        command: 'run',
        rootPath: process.cwd(),
        normalizedConfig: withDefaultConfig({ passWithNoTests: true }),
        projects: [],
        reporters: [blobReporter],
        reporterResults: { results: [], testResults: [] },
        snapshotManager: { summary: {} },
        exitCode: createExitCode(),
        updateReporterResultState: rs.fn(),
      } as unknown as InternalContext;

      if (interrupted) context.exitCode.raise(130);
      await finalizeRunCycle(context, {
        outcomes: [
          {
            results: [],
            testResults: [],
            errors: [],
            testPaths: [],
            duration: { buildTime: 0, testTime: 0 },
            coverage: { raw: [{}] },
          },
        ],
        mode: 'all',
        isWatchMode: false,
        isInterrupted: () => interrupted,
        reportersStarted: phase !== 'pre-start',
        coverageProvider,
        reportOnFailure: false,
        traceRun: {
          onEvents: undefined,
          span: noopTraceSpan,
          finalize: finalizeTrace,
        },
      });

      expect(generatedReports).toEqual(
        interrupted && phase !== 'reporter' ? [] : [1],
      );
      expect(blobReporter.onTestRunEnd).toHaveBeenCalledTimes(
        phase === 'pre-start' ? 0 : 1,
      );
      expect(context.updateReporterResultState).toHaveBeenCalledTimes(1);
      expect(finalizeTrace).toHaveBeenCalledTimes(1);
      expect(context.exitCode.current).toBe(
        interrupted ? 130 : phase === 'coverage' ? 1 : 0,
      );
    },
  );
});

describe('run-level reporter hook failures', () => {
  const makeReporterContext = (reporters: Reporter[]): InternalContext =>
    ({
      command: 'run',
      rootPath: process.cwd(),
      normalizedConfig: withDefaultConfig({ passWithNoTests: true }),
      projects: [],
      reporters,
      reporterResults: { results: [], testResults: [] },
      snapshotManager: { summary: {} },
      exitCode: createExitCode(),
      updateReporterResultState: rs.fn(),
    }) as unknown as InternalContext;

  it('notifies every reporter on run start and records each failure with attribution', async () => {
    const calls: string[] = [];
    class BrokenReporter {
      onTestRunStart() {
        calls.push('broken');
        throw new Error('run-start boom');
      }
    }
    const context = makeReporterContext([
      new BrokenReporter(),
      {
        onTestRunStart() {
          calls.push('anonymous');
          throw new Error('anonymous boom');
        },
      },
      {
        onTestRunStart() {
          calls.push('healthy');
        },
      },
    ]);

    const firstFailure = await notifyReportersOnTestRunStart(context, [
      { testPath: '/root/a.test.ts', project: 'default' },
    ]);
    expect(firstFailure?.message).toBe(
      'Reporter BrokenReporter (#1) onTestRunStart failed: run-start boom',
    );
    expect(calls).toEqual(['broken', 'anonymous', 'healthy']);
    expect(
      (await drainReporterHooks(context)).map((error) => error.message),
    ).toEqual([
      'Reporter BrokenReporter (#1) onTestRunStart failed: run-start boom',
      'Reporter <anonymous> (#2) onTestRunStart failed: anonymous boom',
    ]);
  });

  it('keeps notifying reporters on run end and fails the process after the payload', async () => {
    const calls: string[] = [];
    class BrokenReporter {
      onTestRunEnd() {
        calls.push('broken');
        throw new Error('run-end boom');
      }
    }
    const context = makeReporterContext([
      new BrokenReporter(),
      {
        onTestRunEnd() {
          calls.push('healthy');
        },
      },
    ]);
    const stderr = rs
      .spyOn(logger, 'stderr')
      .mockImplementation(() => undefined);
    onTestFinished(() => {
      stderr.mockRestore();
    });

    await notifyReportersOnTestRunEnd({
      context,
      payload: { ...emptyRunEndPayload },
    });

    expect(calls).toEqual(['broken', 'healthy']);
    expect(context.exitCode.current).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled Reporter Error'),
    );
  });

  it('records one reporter failure once when the run start aborts every executor', async () => {
    const recordedError = new Error(
      'Reporter BrokenReporter (#1) onTestRunStart failed: run-start boom',
    );
    const payloads: TestRunEndPayload[] = [];
    const context = makeReporterContext([
      {
        onTestRunEnd(payload) {
          payloads.push(payload);
        },
      },
    ]);
    recordReporterError(context, recordedError);
    // Aborted executors contribute empty outcomes; the recorded failure has a
    // single owner and must not be duplicated per executor.
    const outcome = {
      results: [],
      testResults: [],
      errors: [],
      testPaths: [],
      duration: { buildTime: 0, testTime: 0 },
    };

    await finalizeRunCycle(context, {
      outcomes: [outcome, { ...outcome }],
      mode: 'all',
      isWatchMode: false,
      isInterrupted: () => false,
      reportersStarted: true,
      coverageProvider: null,
      reportOnFailure: false,
      traceRun: {
        onEvents: undefined,
        span: noopTraceSpan,
        finalize: async () => {},
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.unhandledErrors.map((error) => error.message)).toEqual([
      recordedError.message,
    ]);
    expect(payloads[0]!.status).toBe('error');
    expect(context.exitCode.current).toBe(1);
  });
});
