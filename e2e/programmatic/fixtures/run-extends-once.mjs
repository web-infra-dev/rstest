import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@rstest/core';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'extends-once');

// `loadConfig` resolves the disk config's `extends` (merging setup.ts into
// setupFiles). The programmatic API then resolves the returned config a second
// time — the setup file must still run exactly once, which the test asserts.
const rstest = await createRstest({
  cwd,
  config: async () => {
    const { content } = await loadConfig({ cwd, path: 'rstest.config.ts' });
    return content;
  },
});
const result = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    setupFiles: rstest.context.normalizedConfig.setupFiles.map((p) =>
      p.split('/').pop(),
    ),
    testsPassed: result.stats.tests.passed,
    testsFailed: result.stats.tests.failed,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
