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
  provider?: 'istanbul' | 'v8';
};
