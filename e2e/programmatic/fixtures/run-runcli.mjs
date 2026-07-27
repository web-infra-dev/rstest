import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCLI } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// runCLI is the CLI passthrough for bridges (e.g. a unified `rs` CLI): hand it a
// raw `process.argv`-shaped array and it runs the matched command exactly like
// the `rstest` bin. The positional `sum.test.ts` filters to the passing file
// (the sibling `failing.test.ts` is left out), so the run exits 0.
await runCLI({ argv: ['node', 'rstest', 'run', 'sum.test.ts'], cwd });

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    // runCLI ran a full CLI run and handed control back without process.exit,
    // leaving the CLI's own exit code on the host — 0 for this passing run.
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
