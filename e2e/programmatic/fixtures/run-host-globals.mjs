import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// Simulate a host that owns a clean process: no test-mode env, no exit code.
delete process.env.NODE_ENV;
delete process.env.RSTEST;

const sample = () => ({
  exitCode: process.exitCode ?? null,
  NODE_ENV: process.env.NODE_ENV ?? null,
  RSTEST: process.env.RSTEST ?? null,
});

const before = sample();

const rstest = await createRstest({
  cwd,
  // failing.test.ts fails, so the run has a non-zero outcome — the case where
  // an engine-level `process.exitCode` write would surface.
  config: { include: ['*.test.ts'], reporters: [] },
});

const afterCreate = sample();

// Probe the host from a concurrent timer *while* the run is in flight. Before /
// after sampling alone cannot tell "never mutated" apart from "mutated and
// restored" — the distinction the host-safety guarantee turns on.
const samples = [];
const probe = setInterval(() => {
  samples.push(sample());
}, 5);

const result = await rstest.run();

clearInterval(probe);
const afterRun = sample();

// The run's own exit code is a value, so no sample may show one on the host...
const samplesWithExitCode = samples.filter((s) => s.exitCode !== null);
// ...and the only env the API is allowed to write is the CLI's two test-mode
// markers, which it claims once and leaves alone (see `build` in api/index.ts).
const samplesWithUnexpectedEnv = samples.filter(
  (s) => s.NODE_ENV !== 'test' || s.RSTEST !== 'true',
);

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    failedTests: result.stats.tests.failed,
    before,
    afterCreate,
    afterRun,
    sampleCount: samples.length,
    samplesWithExitCode: samplesWithExitCode.slice(0, 5),
    samplesWithUnexpectedEnv: samplesWithUnexpectedEnv.slice(0, 5),
  })}__END__`,
);
