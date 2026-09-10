import { withDefaultConfig } from '../../src/config';
import { createExitCode } from '../../src/core/exitCode';
import { finalizeRunCycle } from '../../src/core/finalizeRun';
import { BlobReporter } from '../../src/reporter/blob';
import type { InternalContext } from '../../src/types';
import type { CoverageMap, CoverageProvider } from '../../src/types/coverage';
import { noopTraceSpan } from '../../src/utils';

describe('finalizeRunCycle', () => {
  it.for(['none', 'before', 'reporter', 'raw'])(
    'finalizes blob runs with interruption at %s',
    async (phase) => {
      let interrupted = phase === 'before';
      const generatedReports: number[] = [];
      const coverageMap: CoverageMap = {
        data: {},
        addFileCoverage() {},
        files: () => [],
        fileCoverageFor() {
          throw new Error('No file coverage');
        },
        filter() {},
        getCoverageSummary() {
          throw new Error('No coverage summary');
        },
        merge() {},
        toJSON: () => ({}),
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
        },
        cleanup() {},
      } satisfies CoverageProvider;
      const blobReporter = Object.create(
        BlobReporter.prototype,
      ) as BlobReporter;
      blobReporter.onTestRunEnd = rs.fn(async () => {
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
        updateReporterResultState() {},
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
        coverageProvider,
        reportOnFailure: false,
        traceRun: {
          onEvents: undefined,
          span: noopTraceSpan,
          finalize: finalizeTrace,
        },
      });

      expect(generatedReports).toEqual(interrupted ? [] : [1]);
      expect(blobReporter.onTestRunEnd).toHaveBeenCalledTimes(1);
      expect(finalizeTrace).toHaveBeenCalledTimes(1);
      expect(context.exitCode.current).toBe(interrupted ? 130 : 0);
    },
  );
});
