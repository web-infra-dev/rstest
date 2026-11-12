import { describe, expect, it } from '@rstest/core';
import type { BrowserProjectRuntime } from '../src/protocol';
import type { ScheduledTestFile } from '../src/schedulerSeam';
import { expandToRows, getMixedLaneConcurrency } from '../src/schedulerSeam';

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

describe('getMixedLaneConcurrency', () => {
  const files = [{ testPath: '/tests/a.test.ts', projectName: 'web' }];
  const headlessRows = [row('web', 'chromium'), row('web', 'firefox')];
  const headedRow = row('web', 'webkit');
  const contextWith = (maxWorkers: number) =>
    ({ command: 'run', normalizedConfig: { pool: { maxWorkers } } }) as const;

  it('sizes the budget by file x row runs, not by file count', () => {
    // One file on two headless rows plus the headed run is three runs, so
    // maxWorkers 2 stays 2 instead of clamping to the single file.
    expect(
      getMixedLaneConcurrency(contextWith(2), {
        headlessFiles: files,
        headlessRows,
        headedFiles: files,
        headedRow,
      }),
    ).toBe(2);
  });

  it('keeps maxWorkers 1 serial', () => {
    expect(
      getMixedLaneConcurrency(contextWith(1), {
        headlessFiles: files,
        headlessRows,
        headedFiles: files,
        headedRow,
      }),
    ).toBe(1);
  });
});
