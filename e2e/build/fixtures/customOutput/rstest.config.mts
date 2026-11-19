import { realpathSync } from 'node:fs';
import { defineConfig } from '@rstest/core';

const permissionOutputDir = process.env.RSTEST_PERMISSION_OUTPUT_DIR;

export default defineConfig({
  dev: {
    writeToDisk: true,
  },
  output: {
    distPath: {
      root: permissionOutputDir ?? 'custom/.rstest-temp',
    },
  },
  ...(permissionOutputDir && {
    pool: {
      type: 'forks',
      maxWorkers: 1,
      execArgv: [
        process.allowedNodeEnvironmentFlags.has('--permission')
          ? '--permission'
          : '--experimental-permission',
        `--allow-fs-read=${realpathSync(new URL('../../../../', import.meta.url))}`,
      ],
    },
  }),
});
