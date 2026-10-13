import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserCliWithCwd,
} from './utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('browser mode - screenshot matching', () => {
  const fixturesTargetPath = path.join(
    __dirname,
    `fixtures-test-screenshot${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`,
  );
  let fixtureDir = '';
  let fixturesFs: Awaited<ReturnType<typeof prepareFixtures>>['fs'] | undefined;
  let cliToKill:
    Awaited<ReturnType<typeof runBrowserCliWithCwd>>['cli'] | undefined;

  const runScreenshot = async (args: string[] = []) => {
    const result = await runBrowserCliWithCwd(fixtureDir, { args });
    cliToKill = result.cli;
    return result;
  };

  beforeEach(async () => {
    const { fs: preparedFs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures', 'screenshot'),
      fixturesTargetPath,
    });
    fixturesFs = preparedFs;
    fixtureDir = fixturesTargetPath;
  });

  afterEach(async () => {
    const pid = cliToKill?.exec.process?.pid;
    const exitCode = cliToKill?.exec.process?.exitCode;
    if (pid && (exitCode === null || exitCode === undefined) && cliToKill) {
      await killCliProcessTree(cliToKill);
    }
    cliToKill = undefined;
    await deleteFixtureTarget(fixturesFs, fixturesTargetPath);
    fixturesFs = undefined;
  });

  it('creates, compares, and updates PNG references', async () => {
    const screenshotRoot = path.join(fixtureDir, 'tests', '__screenshots__');
    expect(fs.existsSync(screenshotRoot)).toBe(false);

    const firstRun = await runScreenshot(['tests/screenshot.test.ts']);
    await firstRun.expectExecSuccess();

    const projectDirs = fs.readdirSync(screenshotRoot);
    expect(projectDirs.sort()).toEqual(['project-a', 'project-b']);
    const screenshotDir = path.join(
      screenshotRoot,
      'project-a',
      'screenshot.test',
    );
    const secondProjectDir = path.join(
      screenshotRoot,
      'project-b',
      'screenshot.test',
    );
    const referenceName = fs
      .readdirSync(screenshotDir)
      .find((name) => name.startsWith('primary-button-'));
    if (!referenceName)
      throw new Error('Expected the screenshot reference to be generated.');
    expect(referenceName).toMatch(
      new RegExp(`^primary-button-chromium-${process.platform}\\.png$`),
    );
    const referencePath = path.join(screenshotDir, referenceName);
    expect(fs.existsSync(path.join(secondProjectDir, referenceName))).toBe(
      true,
    );
    const originalReference = fs.readFileSync(referencePath);
    expect(originalReference.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );

    const matchingRun = await runScreenshot(['tests/screenshot.test.ts']);
    await matchingRun.expectExecSuccess();
    const unchangedReference = fs.readFileSync(referencePath);
    const updateMatchingRun = await runScreenshot([
      'tests/screenshot.test.ts',
      '--update',
    ]);
    await updateMatchingRun.expectExecSuccess();
    expect(fs.readFileSync(referencePath)).toEqual(unchangedReference);

    const testPath = path.join(fixtureDir, 'tests', 'screenshot.test.ts');
    const originalTest = fs.readFileSync(testPath, 'utf8');
    const changedTest = originalTest.replace(
      'rgb(20, 80, 180)',
      'rgb(180, 40, 20)',
    );
    expect(changedTest).not.toBe(originalTest);
    fs.writeFileSync(testPath, changedTest);

    const mismatchRun = await runScreenshot(['tests/screenshot.test.ts']);
    await mismatchRun.cli.exec;
    expect(mismatchRun.cli.exec.exitCode).toBe(1);
    expect(`${mismatchRun.cli.stdout}\n${mismatchRun.cli.stderr}`).toContain(
      'Screenshot does not match the stored reference',
    );
    expect(`${mismatchRun.cli.stdout}\n${mismatchRun.cli.stderr}`).toContain(
      'Actual:',
    );
    expect(`${mismatchRun.cli.stdout}\n${mismatchRun.cli.stderr}`).toContain(
      'Diff:',
    );
    const failureDir = path.join(screenshotDir, '__failures__');
    expect(
      fs.readdirSync(failureDir).some((name) => name.endsWith('.actual.png')),
    ).toBe(true);
    expect(
      fs.readdirSync(failureDir).some((name) => name.endsWith('.diff.png')),
    ).toBe(true);

    const updateRun = await runScreenshot([
      'tests/screenshot.test.ts',
      '--update',
    ]);
    await updateRun.expectExecSuccess();
    expect(fs.readFileSync(referencePath)).not.toEqual(originalReference);

    const updatedMatchRun = await runScreenshot(['tests/screenshot.test.ts']);
    await updatedMatchRun.expectExecSuccess();
  });
});
