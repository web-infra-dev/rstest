import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

const rstest = await createRstest({
  cwd,
  inlineConfig: {
    include: ['*.test.ts'],
    exclude: ['failing.test.ts'],
    reporters: [],
  },
});
const result = await rstest.run();
await rstest.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    files: result.files.map((f) => ({
      status: f.status,
      // strip absolute path so snapshot is stable across machines
      testPath: f.testPath.split('/').pop(),
    })),
    unhandledErrors: result.unhandledErrors,
    duration: { hasTotal: typeof result.duration.total === 'number' },
    snapshotPresent: typeof result.snapshot === 'object',
  })}__END__`,
);
