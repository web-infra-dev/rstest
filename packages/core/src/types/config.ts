export interface RstestConfig {
  /**
   * Project root
   *
   * @default process.cwd()
   */
  root?: string;
  /**
   * A list of glob patterns that match your test files.
   *
   * @default ['**\/*.{test,spec}.?(c|m)[jt]s?(x)']
   */
  include?: string[];
  /**
   * A list of glob patterns that should be excluded from your test files.
   *
   * @default ['**\/node_modules/**', '**\/dist/**']
   */
  exclude?: string[];
}

export type NormalizedConfig = Required<RstestConfig>;
