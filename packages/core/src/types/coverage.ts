import type { CoverageMap } from 'istanbul-lib-coverage';
import type { ReportOptions } from 'istanbul-reports';

type ReportWithOptions<Name extends keyof ReportOptions = keyof ReportOptions> =
  Name extends keyof ReportOptions
    ? [Name, Partial<ReportOptions[Name]>]
    : [Name, Record<string, unknown>];

export type CoverageOptions = {
  /**
   * Enable coverage collection.
   * @default false
   */
  enabled?: boolean;

  /**
   * The provider to use for coverage collection.
   * @default 'istanbul'
   */
  provider?: 'istanbul';

  /**
   * The reporters to use for coverage collection.
   * @default ['text', 'html', 'clover', 'json']
   */
  reporters?: (keyof ReportOptions | ReportWithOptions)[];

  /**
   * The directory to store coverage reports.
   * @default './coverage'
   */
  reportsDirectory?: string;

  /**
   * Whether to clean the coverage directory before running tests.
   * @default true
   */
  clean?: boolean;
};

export type NormalizedCoverageOptions = Required<CoverageOptions>;

export declare class CoverageProvider {
  constructor(options: CoverageOptions);
  /**
   * Initialize coverage collection
   */
  init(): void;

  /**
   * Collect coverage data from global coverage object
   */
  collect(): CoverageMap | null;

  /**
   * Create a new coverage map
   */
  createCoverageMap(): CoverageMap;

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
