import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@rstest/core';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'config-file-buildcache');
// The config lives in a nested dir so its directory differs from the run root
// (cwd). `loadConfig` records the resolved path on the config it returns, and
// returning that config carries it into `createRstest` — no explicit option.
const configPath = join('nested', 'rstest.config.ts');

const rstest = await createRstest({
  cwd,
  config: async () => (await loadConfig({ cwd, path: configPath })).content,
});

const buildCache = rstest.context.normalizedConfig.performance?.buildCache;
const deps =
  buildCache && buildCache !== true ? buildCache.buildDependencies : undefined;

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    // The config-relative `./extra.js` must resolve against the config file's
    // directory (nested/), proving the config file path threaded through.
    resolvedDep: deps?.find((d) => d.endsWith('extra.js')) ?? null,
    expected: resolve(cwd, 'nested', 'extra.js'),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
