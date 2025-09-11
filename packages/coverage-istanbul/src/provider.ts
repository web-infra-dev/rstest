import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import istanbulLibCoverage from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const { createCoverageMap } = istanbulLibCoverage;

interface CoverageMap {
  files(): string[];
  merge(other: any): void;
  toJSON(): any;
}

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
        dir: 'coverage',
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
