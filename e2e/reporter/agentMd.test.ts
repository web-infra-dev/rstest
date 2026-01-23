import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('agent-md', () => {
  it('outputs markdown report', async ({ onTestFinished }) => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'agent-md/index', '-c', './rstest.agentMd.config.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = cli.stdout
      .replace(/timestamp: ".*?"/g, 'timestamp: "<timestamp>"')
      .replace(
        / {2}"durationMs": \{\n {4}"total": \d+,\n {4}"build": \d+,\n {4}"tests": \d+\n {2}\}/,
        '  "durationMs": {\n    "total": 0,\n    "build": 0,\n    "tests": 0\n  }',
      )
      .replace(/"duration": \d+/g, '"duration": 0');
    const logs = normalized.split('\n').filter(Boolean);
    expectLog('# Rstest Agent Report', logs);
    expect(normalized).toMatchSnapshot();
  });

  it('labels snapshot mismatch errors', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'agent-md/snapshotMismatch',
        '-c',
        './rstest.agentMd.snapshotMismatch.config.ts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            AI_AGENT: 'rstest-e2e',
          },
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const normalized = cli.stdout
      .replace(/timestamp: ".*?"/g, 'timestamp: "<timestamp>"')
      .replace(
        / {2}"durationMs": \{\n {4}"total": \d+,\n {4}"build": \d+,\n {4}"tests": \d+\n {2}\}/,
        '  "durationMs": {\n    "total": 0,\n    "build": 0,\n    "tests": 0\n  }',
      )
      .replace(/"duration": \d+/g, '"duration": 0');

    expect(normalized).toContain('"type": "SnapshotMismatchError"');
    expect(normalized).toMatchSnapshot();
  });
});
