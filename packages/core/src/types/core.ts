import type { SnapshotManager } from '@vitest/snapshot/manager';
import type {
  NormalizedConfig,
  NormalizedProjectConfig,
  RstestConfig,
} from './config';
import type { Reporter } from './reporter';

export type RstestCommand = 'watch' | 'run' | 'list';

export type Project = { config: RstestConfig; configFilePath?: string };

export type ProjectContext = {
  name: string;
  environmentName: string;
  rootPath: string;
  configFilePath?: string;
  normalizedConfig: NormalizedProjectConfig;
};

export type RstestContext = {
  /** The Rstest core version. */
  version: string;
  /** The root path of current project. */
  rootPath: string;
  /** The original Rstest config passed from the createRstest method. */
  originalConfig: Readonly<RstestConfig>;
  /** The normalized Rstest config. */
  normalizedConfig: NormalizedConfig;
  /** filter by a filename regex pattern */
  fileFilters?: string[];
  /** The config file path. */
  configFilePath?: string;
  /**
   * Run tests from one or more projects.
   */
  projects: ProjectContext[];
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

export type ListCommandOptions = {
  filesOnly?: boolean;
  json?: boolean | string;
};

export type RstestInstance = {
  context: RstestContext;
  runTests: () => Promise<void>;
  listTests: (options: ListCommandOptions) => Promise<void>;
};
