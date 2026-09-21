import { withDefaultConfig } from '../../src/config';
import { createExitCode } from '../../src/core/exitCode';
import { finalizeRunCycle } from '../../src/core/finalizeRun';
import { BlobReporter } from '../../src/reporter/blob';
import type { InternalContext } from '../../src/types';
import type {
  CoverageMap,
  CoverageMapData,
  CoverageProvider,
} from '../../src/types/coverage';
import { noopTraceSpan } from '../../src/utils';

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
