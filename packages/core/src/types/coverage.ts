import type {
  CoverageMap,
  CoverageMapData,
  CoverageSummary,
  FileCoverageData,
  Totals,
} from 'istanbul-lib-coverage';
import type { ReportBase } from 'istanbul-lib-report';
import type { ReportOptions } from 'istanbul-reports';

type ReportWithOptions<Name extends keyof ReportOptions = keyof ReportOptions> =
  Name extends keyof ReportOptions
    ? [Name, Partial<ReportOptions[Name]>]
    : [Name, Record<string, unknown>];

export type CoverageThreshold = {
  /** Threshold for statements */
  statements?: number;
  /** Threshold for functions */
  functions?: number;
  /** Threshold for branches */
  branches?: number;
  /** Threshold for lines */
  lines?: number;
};

export type CoverageSummaryTotals = Totals;

export type { CoverageMap, CoverageMapData, CoverageSummary };

export type CoverageThresholds =
  | CoverageThreshold
  | (CoverageThreshold & ThresholdGlobRecord);

/** check thresholds for matched files */
type ThresholdGlobRecord = Record<
  string,
  CoverageThreshold & {
    /**
     * check thresholds per file
     * @default false
     */
    perFile?: boolean;
  }
>;

export type CoverageOptions = {
  /**
   * Enable coverage collection.
   * @default false
   */
  enabled?: boolean;

  /**
   * A list of glob patterns that should be included for coverage collection.
   * Only collect coverage for tested files by default.
   *
   * @default undefined
   */
  include?: string[];

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
  reporters?: (keyof ReportOptions | ReportWithOptions | ReportBase)[];

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

  /**
   * Whether to report coverage when tests fail.
   * @default false
   */
  reportOnFailure?: boolean;
};

export type NormalizedCoverageOptions = Required<
  Omit<CoverageOptions, 'thresholds' | 'include'>
> & {
  thresholds?: CoverageThresholds;
  include?: string[];
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
   * Generate coverage for untested files
   */
  generateCoverageForUntestedFiles(params: {
    environmentName: string;
    files: string[];
  }): Promise<FileCoverageData[]>;

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
