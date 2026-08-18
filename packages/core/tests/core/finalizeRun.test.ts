import { withDefaultConfig } from '../../src/config';
import { createExitCode } from '../../src/core/exitCode';
import { finalizeRunCycle } from '../../src/core/finalizeRun';
import { BlobReporter } from '../../src/reporter/blob';
import type { RstestContext } from '../../src/types';
import type { CoverageMap, CoverageProvider } from '../../src/types/coverage';
import { noopTraceSpan } from '../../src/utils';

describe('finalizeRunCycle', () => {
  it('finalizes blob coverage for providers without deferred finalization support', async () => {
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
      createCoverageMap: () => coverageMap,
      generateCoverageForUntestedFiles: async () => [],
      async generateReports() {
        generatedReports.push(1);
      },
      cleanup() {},
    } satisfies CoverageProvider;
    const blobReporter = Object.create(BlobReporter.prototype) as BlobReporter;
    blobReporter.onTestRunEnd = async () => {};

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
    } as unknown as RstestContext;

    await finalizeRunCycle(context, {
      outcomes: [],
      mode: 'all',
      isWatchMode: false,
      coverageProvider,
      reportOnFailure: false,
      traceRun: {
        onEvents: undefined,
        span: noopTraceSpan,
        finalize: async () => {},
      },
    });

    expect(generatedReports).toEqual([1]);
  });
});
