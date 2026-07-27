import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';
// The CLI half of this pair discovers the same file as its config. Importing it
// here (the programmatic API never reads a config file itself) is what makes
// "same fixture, same thresholds, other surface" true, rather than two copies
// that can drift apart.
import config from './coverage-threshold/rstest.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'coverage-threshold');

const rstest = await createRstest({ cwd, config });
const result = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    // The coverage failure is a returned value; the host's exit code is
    // never written, so it is still the host's own.
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
