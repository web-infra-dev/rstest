import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'global-setup-env');

const KEY = 'RSTEST_API_GS_ENV';
delete process.env[KEY];

const hostValue = () => process.env[KEY] ?? null;
const before = hostValue();

const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    reporters: [],
    globalSetup: ['./globalSetup.ts'],
  },
});

// The env change-set only exists once globalSetup has run, i.e. mid-run — so
// sample the host continuously rather than just before and after.
const duringSamples = [];
const probe = setInterval(() => {
  duringSamples.push(hostValue());
}, 5);

const result = await rstest.run();

clearInterval(probe);
const after = hostValue();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    // The worker test asserts it *did* see the value, so a passing run is the
    // proof that the change-set reached the pool.
    ok: result.ok,
    passedTests: result.stats.tests.passed,
    before,
    after,
    sampleCount: duringSamples.length,
    dirtyDuring: duringSamples.filter((value) => value !== null).slice(0, 5),
  })}__END__`,
);
