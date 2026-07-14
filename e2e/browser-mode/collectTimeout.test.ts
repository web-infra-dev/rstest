import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';
import { runBrowserCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Phase 4 step 9 gate: browser collect mode runs through `TestExecutor.collect`
 * with the host's 30s per-page watchdog. A test file that delays its module
 * evaluation must still be collected — collect honors the full timeout budget
 * instead of cutting off early.
 */
describe('browser mode - collect honors the shared timeout', () => {
  it('lists a test whose module load is slower than instant', async () => {
    const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'browser-collect-timeout'),
      { command: 'list' },
    );

    await expectExecSuccess();

    const output = cli.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => pathe.normalize(l))
      .join('\n');

    expect(output).toContain(
      'tests/slow.test.ts > collected after a slow module load',
    );
  });
});
