import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));

const KEY = 'RSTEST_API_CONCURRENT_ENV';
delete process.env[KEY];

// Two instances in one process, each with a globalSetup that sets the SAME env
// key to a different value. Their test files assert their own value, so if the
// change-sets were transported through the shared host `process.env`, whichever
// setup ran second would win and one run would fail.
const runProject = async (name) => {
  const rstest = await createRstest({
    cwd: join(__dirname, 'concurrent-env', name),
    config: {
      include: ['*.test.ts'],
      reporters: [],
      globalSetup: ['./globalSetup.ts'],
    },
  });
  const result = await rstest.run();
  return {
    ok: result.ok,
    passed: result.stats.tests.passed,
    failed: result.stats.tests.failed,
  };
};

const hostValue = () => process.env[KEY] ?? null;
const samples = [];
const probe = setInterval(() => {
  samples.push(hostValue());
}, 5);

const [alpha, beta] = await Promise.all([
  runProject('alpha'),
  runProject('beta'),
]);

clearInterval(probe);

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    alpha,
    beta,
    after: hostValue(),
    sampleCount: samples.length,
    dirtyDuring: samples.filter((value) => value !== null).slice(0, 5),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
