declare module '@rstest/browser-manifest' {
  export const projectConfig: {
    name: string;
    environmentName: string;
    projectRoot: string;
  };

  export const setupLoaders: Array<() => Promise<unknown>>;

  /** Get all matching test file keys (relative paths, e.g., './src/foo.test.ts') */
  export function getTestKeys(): string[];

  /** Dynamically load a test file by its context key */
  export function loadTest(key: string): Promise<unknown>;
}
