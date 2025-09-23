import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import type { CoverageMap, FileCoverageData } from 'istanbul-lib-coverage';
import istanbulLibCoverage from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';

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

  async generateCoverageForUntestedFiles(
    uncoveredFiles: string[],
  ): Promise<FileCoverageData[]> {
    const { transformCoverage } = await import('./plugin');

    const { readInitialCoverage } = await import('istanbul-lib-instrument');
    // TODO: use swc to parse code and get the coverage data
    const {
      default: { MAGIC_VALUE },
      // @ts-expect-error
    } = await import('istanbul-lib-instrument/src/constants.js');

    const { readFile } = await import('node:fs/promises');

    return await Promise.all(
      uncoveredFiles.map(async (file) => {
        try {
          const content = await readFile(file, 'utf-8');
          const { code } = await transformCoverage(content, file);
          // replace _coverageSchema: "${swc_value}" to _coverageSchema: ${MAGIC_VALUE}
          const { coverageData } =
            readInitialCoverage(
              code.replace(
                /_coverageSchema: "(.*)"/g,
                `_coverageSchema: "${MAGIC_VALUE}"`,
              ),
            ) || {};

          return coverageData;
        } catch (e) {
          console.error(
            `Can not generate coverage for untested file, file: ${file}, error: ${e}`,
          );
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
    if (!coverageMap || coverageMap.files().length === 0) {
      return;
    }

    try {
      const context = createContext({
        dir: this.options.reportsDirectory,
        defaultSummarizer: 'nested',
        coverageMap: createCoverageMap(coverageMap.toJSON()),
      });
      const reportersList = this.options.reporters;
      for (const reporter of reportersList) {
        const [reporterName, reporterOptions] = Array.isArray(reporter)
          ? reporter
          : [reporter, {}];
        const report = reports.create(reporterName, reporterOptions);
        report.execute(context);
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
