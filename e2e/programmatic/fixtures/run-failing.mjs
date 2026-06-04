import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

const rstest = await createRstest({
  cwd,
  inlineConfig: {
    include: ['failing.test.ts'],
    reporters: [],
  },
});
const result = await rstest.run();
await rstest.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
