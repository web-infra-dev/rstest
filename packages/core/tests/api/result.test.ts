import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { join } from 'pathe';
import { Rstest } from '../../src/core/rstest';
import { createResultReporter } from '../../src/api/result';

const rootPath = join(__dirname, '../..');

describe('createResultReporter', () => {
  it('isolates rejected async result callbacks and keeps emitting', async () => {
    const context = new Rstest(
      {
        cwd: rootPath,
        command: 'watch',
        projects: [],
      },
      {},
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    let callbackCount = 0;
    const capture = createResultReporter(context, {
      allowEmpty: true,
      async onResult() {
        callbackCount += 1;
        if (callbackCount === 1) {
          await Promise.resolve();
          throw new Error('host callback failed');
        }
      },
    });
    const emitCycle = async (): Promise<void> => {
      await capture.reporter.onTestRunStart?.();
      await capture.reporter.onTestRunEnd?.({
        results: [],
        testResults: [],
        duration: { totalTime: 0, buildTime: 0, testTime: 0 },
        getSourcemap: async () => null,
        snapshotSummary: context.snapshotManager.summary,
      });
      context.exitCode.finishCycle();
    };

    try {
      await emitCycle();
      await waitForImmediate();
      await emitCycle();
      await waitForImmediate();

      expect(callbackCount).toBe(2);
      expect(unhandledRejections).toEqual([]);
    } finally {
      capture.dispose();
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
