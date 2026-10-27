import { describe, expect, it } from '@rstest/core';
import { parseMarkerPayload } from '../scripts';
import { runBrowserCli } from './utils';

const getHookCount = (output: string, hookName: string): number => {
  return (
    output.match(new RegExp(`\\[browser reporter\\] ${hookName}`, 'g'))
      ?.length ?? 0
  );
};

describe('browser mode - reporter lifecycle hooks', () => {
  it('closes a mixed run when the run-start hook rejects', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('reporter', {
      env: { RSTEST_THROW_RUN_START: '1' },
    });
    await expectExecFailed();
    const payload = parseMarkerPayload<{
      status: string;
      unhandledErrors: { message: string }[];
      events: { event: string }[];
    }>(cli.stdout, '__RSTEST_REPORTER_CONTRACT__');
    expect(payload.status).toBe('error');
    // Every executor observes the same run-start dispatch, so a mixed run
    // reports the failure once, attributed to the reporter and hook.
    expect(payload.unhandledErrors.map(({ message }) => message)).toEqual([
      'Reporter ContractReporter (#2) onTestRunStart failed: run-start rejected',
    ]);
    expect(payload.events).toEqual([{ event: 'run-end' }]);
    expect(getHookCount(cli.stdout, 'onTestRunStart')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
  });

  it.for([true, false])(
    'reports async hook sequence and selection (filtered: %s)',
    async (filtered) => {
      const { expectExecSuccess, cli } = await runBrowserCli('reporter', {
        args: filtered ? ['--project', 'browser'] : [],
      });

      await expectExecSuccess();

      expect(getHookCount(cli.stdout, 'onTestRunStart')).toBe(1);
      const count = filtered ? 1 : 2;
      expect(getHookCount(cli.stdout, 'onTestFileReady')).toBe(count);
      expect(getHookCount(cli.stdout, 'onTestSuiteStart')).toBe(count);
      expect(getHookCount(cli.stdout, 'onTestCaseStart')).toBe(count);
      expect(getHookCount(cli.stdout, 'onTestSuiteResult')).toBe(count);
      expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
      const payload = parseMarkerPayload<{
        selection: {
          files: { testPath: string; testId: string; project: string }[];
        };
        events: { event: string; testId?: string; testPath?: string }[];
      }>(cli.stdout, '__RSTEST_REPORTER_CONTRACT__');
      expect(
        payload.selection.files.map((file) => file.project).sort(),
      ).toEqual(filtered ? ['browser'] : ['browser', 'node']);
      for (const file of payload.selection.files) {
        expect(file.testId).toBe(`file:${file.testPath}`);
        const events = payload.events
          .filter((event) => event.testPath === file.testPath)
          .map((event) => event.event);
        expect(events).toEqual([
          'start-enter',
          'result-enter',
          'start-exit',
          'result-exit',
          'file-result',
        ]);
      }
    },
  );
});
