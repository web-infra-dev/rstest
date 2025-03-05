import { withDefaultConfig } from '../config';
import type { RstestConfig, RstestContext } from '../types';
import { getAbsolutePath } from '../utils/helper';

export function createContext(
  options: { cwd: string },
  userConfig: RstestConfig,
): RstestContext {
  const { cwd } = options;
  const rootPath = userConfig.root
    ? getAbsolutePath(cwd, userConfig.root)
    : cwd;

  const rstestConfig = withDefaultConfig(userConfig);

  return {
    version: RSTEST_VERSION,
    rootPath,
    originalConfig: userConfig,
    normalizedConfig: rstestConfig,
  };
}
