import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

const rstest = await createRstest({
  cwd,
  config: {
    include: ['sum.test.ts'],
    reporters: [],
  },
});

// `printLocation` must enable task-location collection on its own, mirroring the
// CLI — without it the runtime skips locations and `test.location` is undefined.
const withLocation = await rstest.listTests({ printLocation: true });
const withoutLocation = await rstest.listTests({ printLocation: false });
await rstest.close();

const firstCaseLocation = (results) => {
  const cases = results.flatMap((r) => r.tests);
  const withLoc = cases.find((t) => t.location);
  return withLoc ? { line: typeof withLoc.location.line === 'number' } : null;
};

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    withLocation: firstCaseLocation(withLocation),
    withoutLocation: firstCaseLocation(withoutLocation),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
