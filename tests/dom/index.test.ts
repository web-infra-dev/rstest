import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('jsdom', () => {
  it('should run jsdom test correctly', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--testEnvironment=jsdom', 'test/App'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should run jsdom test correctly with custom externals', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--testEnvironment=jsdom',
        'test/App',
        '--config',
        'rstest.externals.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should run jsdom test correctly with jest-dom', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--testEnvironment=jsdom', 'test/jestDom'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});

describe('happy-dom', () => {
  it('should run jsdom test correctly', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--testEnvironment=happy-dom', 'test/App'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should run jsdom test correctly with custom externals', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--testEnvironment=happy-dom',
        'test/App',
        '--config',
        'rstest.externals.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should run jsdom test correctly with jest-dom', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--testEnvironment=happy-dom', 'test/jestDom'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});
