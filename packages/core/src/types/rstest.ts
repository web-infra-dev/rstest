import type { NormalizedConfig, RstestConfig } from './config';

export type RstestCommand = 'watch' | 'run';

export type RstestContext = {
  /** The Rstest core version. */
  version: string;
  /** The root path of current project. */
  rootPath: string;
  /** The original Rstest config passed from the createRstest method. */
  originalConfig: Readonly<RstestConfig>;
  /** The normalized Rstest config. */
  normalizedConfig: NormalizedConfig;
  /**
   * The command type.
   *
   * - dev: `rstest dev`
   * - run: `rstest run`
   */
  command: RstestCommand;
};

export type RstestInstance = {
  runTests: () => Promise<void>;
};
