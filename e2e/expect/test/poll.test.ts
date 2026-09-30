import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

describe('Expect Poll API', () => {
  it('should run expect poll succeed', async () => {
    const logs: string[] = [];
    setTimeout(() => {
      logs.push('hello world');
    }, 100);

    await expect
      .poll(() => logs.some((log) => log.includes('hello world')))
      .toBeTruthy();
  });

  it.fails('should run expect poll failed when unmatched', async () => {
    const logs: string[] = [];
    setTimeout(() => {
      logs.push('hello world');
    }, 100);

    await expect
      .poll(() => logs.some((log) => log.includes('hello world!')), {
        timeout: 300,
      })
      .toBeTruthy();
  });

  it.fails('should run expect poll failed when timeout', async () => {
    const logs: string[] = [];
    setTimeout(() => {
      logs.push('hello world');
    }, 100);

    await expect
      .poll(() => logs.some((log) => log.includes('hello world!')), {
        timeout: 50,
      })
      .toBeTruthy();
  });

  it('keeps a delayed poll bound to the attempt that created it', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/pollRetrySignal.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecSuccess();
  });
});
