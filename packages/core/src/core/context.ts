import { withDefaultConfig } from '../config';
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

  return {
    command,
    version: RSTEST_VERSION,
    rootPath,
    originalConfig: userConfig,
    normalizedConfig: rstestConfig,
  };
}
