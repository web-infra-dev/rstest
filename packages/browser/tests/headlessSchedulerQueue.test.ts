import { describe, expect, it } from '@rstest/core';
import type { BrowserProjectRuntime } from '../src/protocol';
import type { ScheduledTestFile } from '../src/schedulerSeam';
import { expandToRows } from '../src/schedulerSeam';

const row = (
  name: string,
  browserName: BrowserProjectRuntime['browserName'],
): BrowserProjectRuntime => ({
  name,
  browserName,
  instanceName: `${name} (${browserName})`,
  headless: true,
  environmentName: 'browser',
  projectRoot: `/root/${name}`,
  hasSetupFiles: false,
  screenshotFailures: false,
  providerOptions: {},
  launchKey: `[playwright,${browserName}]`,
  runtimeConfig: {} as BrowserProjectRuntime['runtimeConfig'],
});

describe('expandToRows (headless scheduler queue order)', () => {
  it('groups the queue by (project, browser) row so same-row files stay consecutive', () => {
    const chromium = row('web', 'chromium');
    const firefox = row('web', 'firefox');
    const rowsByProject = new Map([['web', [chromium, firefox]]]);
    const queue: ScheduledTestFile[] = expandToRows(
      [
        { testPath: '/tests/a.test.ts', projectName: 'web' },
        { testPath: '/tests/b.test.ts', projectName: 'web' },
      ],
      rowsByProject,
    );

    expect(queue.map((file) => [file.testPath, file.row.browserName])).toEqual([
      ['/tests/a.test.ts', 'chromium'],
      ['/tests/b.test.ts', 'chromium'],
      ['/tests/a.test.ts', 'firefox'],
      ['/tests/b.test.ts', 'firefox'],
    ]);
    // The batch loop's batching condition (`queue[i].row === queue[i-1].row`)
    // must span both files of the non-first rows too.
    expect(queue[0]!.row).toBe(queue[1]!.row);
    expect(queue[2]!.row).toBe(queue[3]!.row);
  });
});
