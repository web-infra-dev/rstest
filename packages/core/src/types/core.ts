import type { SnapshotManager } from '@vitest/snapshot/manager';
import type { NormalizedConfig, RstestConfig } from './config';
import type { Reporter } from './reporter';

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
  reporters: Reporter[];
  snapshotManager: SnapshotManager;
};

export type RstestInstance = {
  runTests: () => Promise<void>;
};
