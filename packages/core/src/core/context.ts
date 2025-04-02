import { SnapshotManager } from '@vitest/snapshot/manager';
import { isCI } from 'std-env';
import { withDefaultConfig } from '../config';
import { DefaultReporter } from '../reporter';
import type { RstestCommand, RstestConfig, RstestContext } from '../types';
import { getAbsolutePath } from '../utils/helper';

export function createContext(
  options: { cwd: string; command: RstestCommand },
  userConfig: RstestConfig,
): RstestContext {
  const { cwd, command } = options;
  const rootPath = userConfig.root
    ? getAbsolutePath(cwd, userConfig.root)
    : cwd;

  const rstestConfig = withDefaultConfig(userConfig);

  const reporters = [new DefaultReporter({ rootPath })];
  const snapshotManager = new SnapshotManager({
    updateSnapshot: rstestConfig.update ? 'all' : isCI ? 'none' : 'new',
  });

  return {
    command,
    version: RSTEST_VERSION,
    rootPath,
    reporters,
    snapshotManager,
    originalConfig: userConfig,
    normalizedConfig: rstestConfig,
  };
}
