import type { CoverageMap, CoverageSummary } from 'istanbul-lib-coverage';
import type { ReportOptions } from 'istanbul-reports';

type ReportWithOptions<Name extends keyof ReportOptions = keyof ReportOptions> =
  Name extends keyof ReportOptions
    ? [Name, Partial<ReportOptions[Name]>]
    : [Name, Record<string, unknown>];

type Thresholds = {
  /** Thresholds for statements */
  statements?: number;
  /** Thresholds for functions */
  functions?: number;
  /** Thresholds for branches */
  branches?: number;
  /** Thresholds for lines */
  lines?: number;
};

export type { CoverageMap, CoverageSummary };

export type CoverageThresholds = Thresholds;

export type CoverageOptions = {
  /**
   * Enable coverage collection.
   * @default false
   */
  enabled?: boolean;

  /**
   * A list of glob patterns that should be excluded from coverage collection.
   *
   * This option accepts an array of wax(https://crates.io/crates/wax)-compatible glob patterns
   *
   * @default ['**\/node_modules/**',
   *           '**\/dist/**',
   *           '**\/test/**',
   *           '**\/__tests__/**',
   *           '**\/*.{test,spec}.?(c|m)[jt]s?(x)',
   *           '**\/__mocks__/**'
   * ]
   */
  exclude?: string[];

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

  /**
   * Coverage thresholds
   *
   * @default undefined
   */
  thresholds?: CoverageThresholds;
};

export type NormalizedCoverageOptions = Required<
  Omit<CoverageOptions, 'thresholds'>
> & {
  thresholds?: CoverageThresholds;
};

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
