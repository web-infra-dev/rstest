import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserCliWithCwd,
  shouldRunHeadedBrowserTests,
} from './utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parseJsonReport = (output: string) => {
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`Cannot find JSON report in output:\n${output}`);
  }
  return JSON.parse(output.slice(jsonStart));
};

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

    const firstRun = await runScreenshot([
      '--reporters=json',
      'tests/screenshot.test.ts',
      'tests/concurrent-screenshot.test.ts',
    ]);
    await firstRun.expectExecSuccess();
    expect(parseJsonReport(firstRun.cli.stdout).snapshot.added).toBe(22);

    const projectDirs = fs.readdirSync(screenshotRoot);
    expect(projectDirs).toHaveLength(2);
    const screenshotDir = path.join(screenshotRoot, 'screenshot.test.ts');
    const screenshotNames = fs
      .readdirSync(screenshotDir)
      .filter((name) => name.endsWith('.png'))
      .sort();
    expect(screenshotNames).toHaveLength(9);
    expect(
      screenshotNames.every((name) => Buffer.byteLength(name) <= 240),
    ).toBe(true);
    const secondProjectScreenshotDir = path.join(
      fixtureDir,
      'tests',
      'project-b-baselines',
      'screenshot.test.ts',
    );
    expect(
      fs
        .readdirSync(secondProjectScreenshotDir)
        .filter((name) => name.endsWith('.png')),
    ).toHaveLength(9);
    expect(screenshotNames).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^assigns-separate-references-to-repeated-unnamed-screenshots-1-[a-f0-9]{64}-chromium-${process.platform}\\.png$`,
        ),
      ),
    );
    expect(screenshotNames).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^assigns-separate-references-to-repeated-unnamed-screenshots-2-[a-f0-9]{64}-chromium-${process.platform}\\.png$`,
        ),
      ),
    );
    const testPath = path.join(fixtureDir, 'tests', 'screenshot.test.ts');
    const originalTest = fs.readFileSync(testPath, 'utf8');
    fs.writeFileSync(
      testPath,
      originalTest.replace(
        "test('matches a locator screenshot'",
        "test('an unrelated earlier test', () => {});\n\ntest('matches a locator screenshot'",
      ),
    );
    const stablePathRun = await runScreenshot(['tests/screenshot.test.ts']);
    await stablePathRun.expectExecSuccess();
    expect(
      fs
        .readdirSync(screenshotDir)
        .filter((name) => name.endsWith('.png'))
        .sort(),
    ).toEqual(screenshotNames);
    fs.writeFileSync(testPath, originalTest);
    const referenceName = fs
      .readdirSync(screenshotDir)
      .find((name) => name.startsWith('primary-button-'));
    if (!referenceName)
      throw new Error('Expected the screenshot reference to be generated.');
    expect(referenceName).toMatch(
      new RegExp(`^primary-button-chromium-${process.platform}\\.png$`),
    );
    const referencePath = path.join(screenshotDir, referenceName);
    expect(
      fs.existsSync(path.join(secondProjectScreenshotDir, referenceName)),
    ).toBe(true);
    expect(
      fs.readdirSync(
        path.join(screenshotRoot, 'concurrent-screenshot.test.ts'),
      ),
    ).toHaveLength(2);
    expect(
      fs.readdirSync(
        path.join(
          fixtureDir,
          'tests',
          'project-b-baselines',
          'concurrent-screenshot.test.ts',
        ),
      ),
    ).toHaveLength(2);
    const originalReference = fs.readFileSync(referencePath);
    expect(originalReference.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );

    const matchingRun = await runScreenshot([
      '--reporters=json',
      'tests/screenshot.test.ts',
    ]);
    await matchingRun.expectExecSuccess();
    expect(parseJsonReport(matchingRun.cli.stdout).snapshot.matched).toBe(20);
    const noTimeoutRun = await runScreenshot([
      '--config=rstest.no-timeout.config.mts',
      'tests/screenshot.test.ts',
    ]);
    await noTimeoutRun.expectExecSuccess();
    const unchangedReference = fs.readFileSync(referencePath);
    const updateMatchingRun = await runScreenshot([
      'tests/screenshot.test.ts',
      '--update',
    ]);
    await updateMatchingRun.expectExecSuccess();
    expect(fs.readFileSync(referencePath)).toEqual(unchangedReference);

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

    for (const projectDir of [screenshotDir, secondProjectScreenshotDir]) {
      const projectReference = path.join(
        projectDir,
        fs
          .readdirSync(projectDir)
          .find((name) => name.startsWith('primary-button-'))!,
      );
      fs.writeFileSync(projectReference, 'corrupt PNG reference');
    }
    const repairRun = await runScreenshot([
      'tests/screenshot.test.ts',
      '--update',
    ]);
    await repairRun.expectExecSuccess();
    const repairedMatchRun = await runScreenshot(['tests/screenshot.test.ts']);
    await repairedMatchRun.expectExecSuccess();
  }, 180_000);

  it('rejects invalid options before creating a reference', async () => {
    const invalidTestPath = path.join(
      fixtureDir,
      'tests',
      'invalid-options.test.ts',
    );
    fs.writeFileSync(
      invalidTestPath,
      `import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('rejects invalid screenshot options', async () => {
  document.body.innerHTML = '<button>Save</button>';
  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot(
    'invalid-options',
    { threshold: 2 },
  );
});

test('rejects a short screenshot stability timeout', async () => {
  document.body.innerHTML = '<button>Save</button>';
  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot(
    'short-stability-timeout',
    { stabilityTimeout: 50 },
  );
});
`,
    );

    const result = await runScreenshot(['tests/invalid-options.test.ts']);
    await result.cli.exec;
    expect(result.cli.exec.exitCode).toBe(1);
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'threshold must be between 0 and 1',
    );
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'stabilityTimeout must be 0 or at least 100ms',
    );
    expect(
      fs.existsSync(path.join(fixtureDir, 'tests', '__screenshots__')),
    ).toBe(false);
  });

  it('uses global matcher defaults and screenshot path configuration', async () => {
    const testPath = path.join(fixtureDir, 'tests', 'configured.test.ts');
    const originalTest = fs.readFileSync(testPath, 'utf8');
    const firstRun = await runScreenshot([
      '--update',
      'tests/configured.test.ts',
    ]);
    await firstRun.expectExecSuccess();

    const customBaselineRoot = path.join(
      fixtureDir,
      'tests',
      'custom-baselines',
      'configured.test.ts',
    );
    const directoryReference = fs
      .readdirSync(customBaselineRoot)
      .find((name) =>
        new RegExp(`^global-default-chromium-${process.platform}\\.png$`).test(
          name,
        ),
      );
    const resolverReference = path.join(
      fixtureDir,
      'custom-paths',
      'project-config-resolver',
      'configured.test.ts',
      'global-default.png',
    );
    expect(directoryReference).toBeDefined();
    expect(fs.existsSync(resolverReference)).toBe(true);

    const changedTest = originalTest.replace(
      'rgb(10, 20, 30)',
      'rgb(180, 40, 20)',
    );
    fs.writeFileSync(testPath, changedTest);
    const globalThresholdRun = await runScreenshot([
      'tests/configured.test.ts',
    ]);
    await globalThresholdRun.expectExecSuccess();

    fs.writeFileSync(
      testPath,
      changedTest.replace(
        ").toMatchScreenshot('global-default');",
        ").toMatchScreenshot('global-default', { maxDiffPixels: 0 });",
      ),
    );
    const overrideRun = await runScreenshot(['tests/configured.test.ts']);
    await overrideRun.cli.exec;
    expect(overrideRun.cli.exec.exitCode).toBe(1);
    expect(`${overrideRun.cli.stdout}\n${overrideRun.cli.stderr}`).toContain(
      'Screenshot does not match the stored reference',
    );
  }, 120_000);

  it.runIf(shouldRunHeadedBrowserTests)(
    'routes headed screenshots to the matching project iframe',
    async () => {
      for (const project of ['project-a', 'project-b']) {
        const headedRun = await runScreenshot([
          '--config=rstest.headed.config.mts',
          '--project',
          project,
          'tests/screenshot.test.ts',
          'tests/concurrent-screenshot.test.ts',
        ]);
        await headedRun.expectExecSuccess();
      }

      const screenshotRoot = path.join(fixtureDir, 'tests', '__screenshots__');
      const projectDirs = fs.readdirSync(screenshotRoot);
      expect(projectDirs).toHaveLength(2);
      expect(
        fs.readdirSync(path.join(screenshotRoot, 'screenshot.test.ts')),
      ).toHaveLength(10);
      expect(
        fs.readdirSync(
          path.join(screenshotRoot, 'concurrent-screenshot.test.ts'),
        ),
      ).toHaveLength(2);
      expect(
        fs.readdirSync(
          path.join(
            fixtureDir,
            'tests',
            'project-b-baselines',
            'screenshot.test.ts',
          ),
        ),
      ).toHaveLength(10);
    },
  );
});
