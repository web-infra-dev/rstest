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
  // TODO: support clean
};

interface CoverageMap {
  files(): string[];
  merge(other: any): void;
  toJSON(): any;
}

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
