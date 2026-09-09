import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Regression test for https://github.com/web-infra-dev/rstest/issues/1367.
// `a.test.ts` captures a `console` reference and flushes it from `setTimeout`s
// that outlive the file. With `isolate: false` every file shares one worker, so
// the late logs fire after the host has disposed a's birpc channel (and, later,
// after the worker has closed it). Forwarding such a log used to leave a pending
// birpc request that `$close()` rejected as `[birpc] rpc is closed`, failing the
// run and misattributing it to `b.test.ts`.
//
// Forwarding is now best-effort: the worker never awaits the forward and
// swallows the rejected send, so a late log can neither crash the run nor leak
// past the `onConsoleLog: () => false` suppression filter. Assert this across
// both pools and both isolate modes: with `isolate: true` each file gets a fresh
// worker so the bug cannot occur, which guards against a regression that only
// fixes one mode.
describe('late console log (issue #1367)', () => {
  for (const pool of ['forks', 'threads'] as const) {
    for (const isolate of [true, false] as const) {
      it(`should not fail the run when a console call outlives its test file (${pool} pool, isolate: ${isolate})`, async () => {
        const { cli, expectExecSuccess } = await runRstestCli({
          command: 'rstest',
          args: ['run', '--pool', pool, '--isolate', String(isolate)],
          options: {
            nodeOptions: {
              cwd: join(__dirname, 'fixtures/late-console'),
            },
          },
        });

        await expectExecSuccess();

        // The late log must not crash the run via a closed/disposed channel...
        expect(cli.log).not.toContain('rpc is closed');
        // ...and it must stay suppressed, not leak to the raw worker stream.
        expect(cli.log).not.toContain('late log from a.test.ts');
      });
    }
  }
});
