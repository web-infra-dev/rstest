import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import type { CoverageMap, FileCoverageData } from 'istanbul-lib-coverage';
import istanbulLibCoverage from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { readInitialCoverage } from './utils';

const { createCoverageMap } = istanbulLibCoverage;

// Global type declaration for coverage
declare global {
  var __coverage__: any;
}

export class CoverageProvider implements RstestCoverageProvider {
  private coverageMap: ReturnType<typeof createCoverageMap> | null = null;

  constructor(private options: NormalizedCoverageOptions) {}

  init(): void {
    // Initialize global coverage object
    if (typeof globalThis !== 'undefined') {
      globalThis.__coverage__ = globalThis.__coverage__ || {};
    }
  }

  async generateCoverageForUntestedFiles({
    environmentName,
    files,
  }: {
    environmentName: string;
    files: string[];
  }): Promise<FileCoverageData[]> {
    const { transformCoverage } = await import('./plugin');

    const { readFile } = await import('node:fs/promises');

    return await Promise.all(
      files.map(async (file) => {
        try {
          const content = await readFile(file, 'utf-8');
          const { code } = await transformCoverage(
            environmentName,
            content,
            file,
          );
          return readInitialCoverage(code);
        } catch (e) {
          console.error(
            `Can not generate coverage for untested file, file: ${file}, error: ${e}`,
          );
          process.exitCode = 1;
          return undefined;
        }
      }),
    ).then((results) => results.filter((r): r is FileCoverageData => !!r));
  }

  createCoverageMap(): CoverageMap {
    return createCoverageMap({});
  }

  collect(): CoverageMap | null {
    if (typeof globalThis === 'undefined' || !globalThis.__coverage__) {
      return null;
    }

    try {
      if (!this.coverageMap) {
        this.coverageMap = createCoverageMap();
      }
      // Merge current coverage data
      if (this.coverageMap) {
        this.coverageMap.merge(globalThis.__coverage__);
      }

      return this.coverageMap;
    } catch (error) {
      console.warn('Failed to collect coverage data:', error);
      return null;
    }
  }

  async generateReports(coverageMap: CoverageMap): Promise<void> {
    try {
      const context = createContext({
        dir: this.options.reportsDirectory,
        coverageMap: createCoverageMap(coverageMap.toJSON()),
      });
      const reportersList = this.options.reporters;
      for (const reporter of reportersList) {
        if (typeof reporter === 'object' && 'execute' in reporter) {
          reporter.execute(context);
        } else {
          const [reporterName, reporterOptions] = Array.isArray(reporter)
            ? reporter
            : [reporter, {}];
          const report = reports.create(
            reporterName as Parameters<typeof reports.create>[0],
            reporterOptions,
          );
          //NOTE: https://github.com/vitest-dev/vitest/blob/41a111c35b6605dbe8a536a6e03b35e9bc0ce770/packages/coverage-istanbul/src/provider.ts#L145
          report.execute(context);
        }
      }
    } catch (error) {
      console.error('Failed to generate coverage reports:', error);
    }
  }

  cleanup(): void {
    if (typeof globalThis !== 'undefined' && '__coverage__' in globalThis) {
      delete globalThis.__coverage__;
    }
    this.coverageMap = null;
  }
}
