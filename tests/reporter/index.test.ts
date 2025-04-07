import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import stripAnsi from 'strip-ansi';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('reporters', () => {
  it('default', async () => {
    const process = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    const logs = stripAnsi(process.stdout);
    expect(logs).toContain('✓ basic > a');
    expect(logs).toContain('✗ basic > b');
  });

  it('custom', async () => {
    const process = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', './rstest.customReporterConfig.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    const logs = stripAnsi(process.stdout);
    expect(logs).toContain('[custom reporter] onTestFileStart');
    expect(logs.match(/\[custom reporter\] onTestCaseResult/g)?.length).toBe(2);
    expect(logs).toContain('[custom reporter] onTestRunEnd');
  });

  it('empty', async () => {
    const process = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', './rstest.emptyReporterConfig.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    const logs = stripAnsi(process.stdout);
    expect(logs).not.toContain('✓ basic > a');
    expect(logs).not.toContain('✗ basic > b');
  });
});
