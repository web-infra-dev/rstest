import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test exclude option', () => {
  beforeAll(() => {
    const distPath = join(__dirname, 'fixtures', 'dist');
    fs.mkdirSync(distPath, { recursive: true });
    const fileName = 'index.test.ts';

    fs.writeFileSync(
      join(distPath, fileName),
      `
      import { expect, it } from '@rstest/core';
      it('should add two numbers correctly', () => {
        expect(1 + 1).toBe(3);
      });
      `,
    );
  });

  it('should exclude dist by default', async () => {
    const { expectLog, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    expectLog('Test Files 1 passed');
  });

  it('should exclude dist correctly with custom exclude', async () => {
    const { expectLog, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--exclude', '**/aaa/**'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    expectLog('Test Files 1 passed');
  });

  it('should not exclude dist correctly with override false', async () => {
    const { expectLog, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.override.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    expectLog('Test Files 1 failed | 1 passed (2)');
  });
});
