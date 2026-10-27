import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const rstest = await createRstest({
  cwd: fixtureDir,
  config: {
    include: ['disk/sum.test.ts'],
    reporters: [],
    globalSetup: './teardown-failure-setup.mjs',
  },
});
const result = await rstest.run();
console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    status: result.status,
    unhandledErrors: result.unhandledErrors.map((error) => error.message),
    summary: result.summary,
    hostExitCode: process.exitCode ?? null,
  })}__END__`,
);
