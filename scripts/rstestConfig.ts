import type { ExtendConfigFn } from '@rstest/core';
import { loadRstackConfig } from 'rstack/config';
import { withRslibConfig } from '../packages/adapter-rslib/src/index';

// Keep workspace tests on the local Rstest runner while inheriting rs lib config.
export function withRstackLibConfig(cwd: string): ExtendConfigFn {
  return async (userConfig) => {
    const { configs, filePath } = await loadRstackConfig({ cwd });
    const config =
      typeof configs.lib === 'function'
        ? await configs.lib({ env: 'test', command: 'test' })
        : configs.lib;

    return withRslibConfig({
      cwd,
      config,
      configPath: filePath ?? undefined,
    })(userConfig);
  };
}
