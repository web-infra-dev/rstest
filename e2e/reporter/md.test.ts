import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const normalizeStdout = (stdout: string) =>
  stdout
    .replace(/timestamp: ".*?"/g, 'timestamp: "<timestamp>"')
    .replace(
      / {2}"durationMs": \{\n {4}"total": \d+,\n {4}"build": \d+,\n {4}"tests": \d+\n {2}\}/,
      '  "durationMs": {\n    "total": 0,\n    "build": 0,\n    "tests": 0\n  }',
    )
    .replace(/"duration": \d+/g, '"duration": 0');

describe('md', () => {
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

    const normalized = normalizeStdout(cli.stdout);
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

    const normalized = normalizeStdout(cli.stdout);

    expect(normalized).toContain('"type": "SnapshotMismatchError"');
    expect(normalized).toMatchSnapshot();
  });

  it('includes console output when enabled', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'agent-md/console',
        '-c',
        './rstest.agentMd.console.config.ts',
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

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toContain('console:');
    expect(normalized).toContain('hello from console.log');
    expect(normalized).toContain('hello from console.warn');
    expect(normalized).toContain('hello from console.error');
    expect(normalized).toMatchSnapshot();
  });

  it('formats thrown errors', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'agent-md/throw', '-c', './rstest.agentMd.throw.config.ts'],
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

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toContain('"message": "boom"');
    expect(normalized).toMatchSnapshot();
  });

  it('labels timeout errors', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'agent-md/timeout',
        '-c',
        './rstest.agentMd.timeout.config.ts',
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

    const normalized = normalizeStdout(cli.stdout);
    expect(normalized).toContain('timeout');
    expect(normalized).toMatchSnapshot();
  });
});
