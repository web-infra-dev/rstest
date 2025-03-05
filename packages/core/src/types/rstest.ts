import type { NormalizedConfig, RstestConfig } from './config';

export type RstestContext = {
  /** The Rstest core version. */
  version: string;
  /** The root path of current project. */
  rootPath: string;
  /** The original Rstest config passed from the createRstest method. */
  originalConfig: Readonly<RstestConfig>;
  /** The normalized Rstest config. */
  normalizedConfig: NormalizedConfig;
};

export type RstestInstance = {
  runTests: () => Promise<void>;
};
