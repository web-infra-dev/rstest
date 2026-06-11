import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Companion to `late-console.test.ts` for https://github.com/web-infra-dev/rstest/issues/1367.
// The worker forwards console output fire-and-forget (it never awaits the
// result, and swallows the rejected send), so a user `onConsoleLog` filter (or a
// reporter's `onUserConsoleLog`) that throws while the host handles a forwarded
// log cannot travel back to fail the test — and would be hidden by that swallow.
// The host must surface that error as a diagnostic instead, while the passing
// test stays green. Assert this for both pools (the host handler is pool-agnostic).
describe('console hook error (issue #1367)', () => {
  for (const pool of ['forks', 'threads'] as const) {
    it(`should surface a throwing onConsoleLog hook without failing the run (${pool} pool)`, async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--pool', pool],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures/console-hook-error'),
          },
        },
      });

      await expectExecSuccess();

      // The hook error must be surfaced on the host, not silently swallowed.
      expect(cli.log).toContain('Failed to handle console log');
      expect(cli.log).toContain('onConsoleLog hook boom');
    });
  }
});
