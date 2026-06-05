import fs from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - filtered mixed run (#1363)', () => {
  it('runs the unified finalize once when the node project matches zero files', async () => {
    const fixtureDir = join(__dirname, 'fixtures/mixed-node-empty');
    const reportPath = join(fixtureDir, 'coverage/coverage-final.json');
    fs.rmSync(join(fixtureDir, 'coverage'), { recursive: true, force: true });

    // Filter to the browser test file only, so the node project matches zero
    // files. Before this fix the run took the empty-node early return and fired
    // neither onTestRunStart nor onTestRunEnd (and wrote no coverage report).
    const { cli, expectExecSuccess } = await runBrowserCli('mixed-node-empty', {
      args: ['feature.test.ts'],
    });

    await expectExecSuccess();

    // Exactly one onTestRunStart + one onTestRunEnd from the single unified
    // finalize — not zero (the old #1363 gap), not two.
    expect(cli.stdout).toContain('[run lifecycle] starts=1 ends=1');

    // The browser project's coverage report is written through the same
    // finalize, scoped so the `coverage.include` filter keeps browser source.
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, 'utf-8')).toContain('calc.ts');
  });
});
