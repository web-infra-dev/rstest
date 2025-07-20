import istanbulLibCoverage from 'istanbul-lib-coverage';
import type { CoverageOptions } from '../types/coverage';

const { createCoverageMap } = istanbulLibCoverage;

import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';

interface CoverageMap {
  files(): string[];
  merge(other: any): void;
  toJSON(): any;
}

// Global type declaration for coverage
declare global {
  var __coverage__: any;
}

export interface CoverageProvider {
  /**
   * Initialize coverage collection
   */
  init(): void;

  /**
   * Collect coverage data from global coverage object
   */
  collect(): CoverageMap | null;

  /**
   * Generate coverage reports
   */
  generateReports(
    coverageMap: CoverageMap,
    options: CoverageOptions,
  ): Promise<void>;

  /**
   * Clean up coverage data
   */
  cleanup(): void;
}

export class IstanbulCoverageProvider implements CoverageProvider {
  private coverageMap: CoverageMap | null = null;

  init(): void {
    // Initialize global coverage object
    if (typeof globalThis !== 'undefined') {
      (globalThis as any).__coverage__ = (globalThis as any).__coverage__ || {};
    }
  }

  collect(): CoverageMap | null {
    if (
      typeof globalThis === 'undefined' ||
      !(globalThis as any).__coverage__
    ) {
      return null;
    }

    try {
      if (!this.coverageMap) {
        this.coverageMap = createCoverageMap();
      }
      // Merge current coverage data
      if (this.coverageMap) {
        this.coverageMap.merge((globalThis as any).__coverage__);
      }

      return this.coverageMap;
    } catch (error) {
      console.warn('Failed to collect coverage data:', error);
      return null;
    }
  }

  async generateReports(
    coverageMap: CoverageMap,
    options: CoverageOptions,
  ): Promise<void> {
    console.log(options);
    if (!coverageMap || coverageMap.files().length === 0) {
      return;
    }

    try {
      const context = createContext({
        dir: 'coverage',
        defaultSummarizer: 'nested',
        coverageMap: createCoverageMap(coverageMap.toJSON()),
      });
      const reportersList = ['html', 'json'];
      for (const reporter of reportersList) {
        const report = reports.create(reporter as any, {
          // Add any specific options for the reporter here
        });
        report.execute(context);
      }

      console.log('\nCoverage reports generated in ./coverage directory');
    } catch (error) {
      console.error('Failed to generate coverage reports:', error);
    }
  }

  cleanup(): void {
    if (typeof globalThis !== 'undefined' && '__coverage__' in globalThis) {
      delete (globalThis as any).__coverage__;
    }
    this.coverageMap = null;
  }
}
