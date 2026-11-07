import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import { runBrowserCliWithCwd, runBrowserWatchCliWithCwd } from './utils';

const fixtureDir = fileURLToPath(
  new URL('../build/fixtures/bareImports', import.meta.url),
);

it('preserves direct test and setup imports without retaining another test’s barrel', async () => {
  const result = await runBrowserCliWithCwd(fixtureDir, {
    args: ['-c', 'rstest.browser.config.mts'],
  });
  await result.expectExecSuccess();
  expect(result.cli.stdout).toContain('2 passed');
});

it('protects direct imports in newly discovered browser tests', async () => {
  const target = join(fixtureDir, '../fixtures-test-bare-imports-browser');
  const { fs } = await prepareFixtures({
    fixturesPath: fixtureDir,
    fixturesTargetPath: target,
  });
  const { cli } = await runBrowserWatchCliWithCwd(target, {
    args: ['-c', 'rstest.browser.config.mts'],
  });
  try {
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('2 passed');
    cli.resetStd();
    fs.create(
      join(target, 'added.test.js'),
      `
import { test, expect } from '@rstest/core';
import './registration.js';
import { answer } from './answer.js';
test('new browser direct import', () => expect(answer()).toBe('test mock'));
`,
    );
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('added.test.js');
    expect(cli.stdout).not.toContain('failed');
  } finally {
    await cli.killProcessTree();
    fs.delete(target);
  }
});
