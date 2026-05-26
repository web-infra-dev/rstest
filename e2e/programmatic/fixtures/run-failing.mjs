import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

const result = await runRstest({
  cwd,
  inlineConfig: {
    include: ['failing.test.ts'],
    reporters: [],
  },
});

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
