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
    expect(parseJsonReport(firstRun.cli.stdout).snapshot.added).toBe(26);

    const projectDirs = fs.readdirSync(screenshotRoot);
    expect(projectDirs).toHaveLength(2);
    const screenshotDirForProject = (projectName: string) => {
      const projectDir = projectDirs.find((name) =>
        name.startsWith(`${projectName}-`),
      );
      if (!projectDir) {
        throw new Error(`Expected screenshot directory for ${projectName}.`);
      }
      return path.join(screenshotRoot, projectDir, 'screenshot.test.ts');
    };
    const screenshotDir = screenshotDirForProject('project-a');
    const secondProjectDir = screenshotDirForProject('project-b');
    const screenshotNames = fs
      .readdirSync(screenshotDir)
      .filter((name) => name.endsWith('.png'))
      .sort();
    expect(screenshotNames).toHaveLength(10);
    const viewportScreenshotName = screenshotNames.find((name) =>
      name.startsWith('viewport-'),
    );
    if (!viewportScreenshotName) {
      throw new Error('Expected the viewport screenshot reference.');
    }
    const viewportScreenshot = fs.readFileSync(
      path.join(screenshotDir, viewportScreenshotName),
    );
    expect(viewportScreenshot.readUInt32BE(20)).toBeLessThan(1800);
    const pageScreenshotName = screenshotNames.find((name) =>
      name.startsWith('whole-page-'),
    );
    if (!pageScreenshotName) {
      throw new Error('Expected the full page screenshot reference.');
    }
    const pageScreenshot = fs.readFileSync(
      path.join(screenshotDir, pageScreenshotName),
    );
    expect(pageScreenshot.readUInt32BE(20)).toBeGreaterThan(1000);
    expect(
      fs.readdirSync(screenshotDir).some((name) => name === 'assertion-2'),
    ).toBe(true);
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
      new RegExp(
        `^primary-button-[a-f0-9]{8}-chromium-${process.platform}\\.png$`,
      ),
    );
    const referencePath = path.join(screenshotDir, referenceName);
    expect(fs.existsSync(path.join(secondProjectDir, referenceName))).toBe(
      true,
    );
    for (const project of ['project-a', 'project-b']) {
      expect(
        fs.readdirSync(
          path.join(
            path.dirname(screenshotDirForProject(project)),
            'concurrent-screenshot.test.ts',
          ),
        ),
      ).toHaveLength(2);
    }
    const originalReference = fs.readFileSync(referencePath);
    expect(originalReference.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );

    const matchingRun = await runScreenshot([
      '--reporters=json',
      'tests/screenshot.test.ts',
    ]);
    await matchingRun.expectExecSuccess();
    expect(parseJsonReport(matchingRun.cli.stdout).snapshot.matched).toBe(24);
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

    for (const projectDir of [screenshotDir, secondProjectDir]) {
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

    const customBaselineRoot = path.join(fixtureDir, 'custom-baselines');
    const projectDirectory = fs
      .readdirSync(customBaselineRoot)
      .find((name) => name.startsWith('project-config-directory-'))!;
    const projectDirectoryPath = path.join(
      customBaselineRoot,
      projectDirectory,
    );
    const testsDirectory = fs
      .readdirSync(projectDirectoryPath)
      .find((name) => /^tests-[a-f0-9]{8}$/.test(name))!;
    const testsDirectoryPath = path.join(projectDirectoryPath, testsDirectory);
    const projectBaselineRoot = path.join(
      testsDirectoryPath,
      fs
        .readdirSync(testsDirectoryPath)
        .find((name) => /^configured\.test\.ts-[a-f0-9]{8}$/.test(name))!,
    );
    const directoryReference = fs
      .readdirSync(projectBaselineRoot)
      .find((name) =>
        new RegExp(
          `^global-default-[a-f0-9]{8}-chromium-${process.platform}\\.png$`,
        ).test(name),
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
      const screenshotTestPath = path.join(
        fixtureDir,
        'tests',
        'screenshot.test.ts',
      );
      const originalTest = fs.readFileSync(screenshotTestPath, 'utf8');
      const headedTest = originalTest.replace(
        "toMatchScreenshot('viewport', {",
        "toMatchScreenshot('headed-viewport', {",
      );
      expect(headedTest).not.toBe(originalTest);
      fs.writeFileSync(screenshotTestPath, headedTest);
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
      for (const project of ['project-a', 'project-b']) {
        const projectDir = projectDirs.find((name) =>
          name.startsWith(`${project}-`),
        );
        if (!projectDir) {
          throw new Error(`Expected screenshot directory for ${project}.`);
        }
        const screenshotDir = path.join(
          screenshotRoot,
          projectDir,
          'screenshot.test.ts',
        );
        const screenshotNames = fs.readdirSync(screenshotDir);
        expect(screenshotNames).toHaveLength(11);
        const viewportScreenshotName = screenshotNames.find((name) =>
          name.startsWith('headed-viewport-'),
        );
        if (!viewportScreenshotName) {
          throw new Error('Expected the headed viewport screenshot reference.');
        }
        const viewportScreenshot = fs.readFileSync(
          path.join(screenshotDir, viewportScreenshotName),
        );
        expect(viewportScreenshot.readUInt32BE(20)).toBeLessThan(1800);
        expect(
          fs.readdirSync(
            path.join(
              screenshotRoot,
              projectDir,
              'concurrent-screenshot.test.ts',
            ),
          ),
        ).toHaveLength(2);
      }
    },
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'includes horizontal overflow in headed full-page captures',
    async () => {
      const screenshotTestPath = path.join(
        fixtureDir,
        'tests',
        'screenshot.test.ts',
      );
      const originalTest = fs.readFileSync(screenshotTestPath, 'utf8');
      const regressionTest = [
        "test('captures a full page with horizontal overflow', async () => {",
        '  document.body.innerHTML = \'<main style="width: 1600px; height: 1200px"></main>\';',
        "  await expect(page).toMatchScreenshot('wide-full-page', { fullPage: true });",
        '});',
      ].join('\n');
      fs.writeFileSync(
        screenshotTestPath,
        `${originalTest}\n${regressionTest}\n`,
      );

      const headedRun = await runScreenshot([
        '--config=rstest.headed.config.mts',
        '--project',
        'project-a',
        'tests/screenshot.test.ts',
        '--update',
      ]);
      await headedRun.expectExecSuccess();

      const screenshotRoot = path.join(fixtureDir, 'tests', '__screenshots__');
      const projectDir = fs
        .readdirSync(screenshotRoot)
        .find((name) => name.startsWith('project-a-'));
      if (!projectDir) {
        throw new Error('Expected the headed project screenshot directory.');
      }
      const screenshotDir = path.join(
        screenshotRoot,
        projectDir,
        'screenshot.test.ts',
      );
      const wideScreenshot = fs
        .readdirSync(screenshotDir)
        .find((name) => name.startsWith('wide-full-page-'));
      if (!wideScreenshot) {
        throw new Error('Expected the wide full-page screenshot reference.');
      }
      const wideScreenshotBuffer = fs.readFileSync(
        path.join(screenshotDir, wideScreenshot),
      );
      expect(wideScreenshotBuffer.readUInt32BE(16)).toBeGreaterThan(1500);
      expect(wideScreenshotBuffer.readUInt32BE(20)).toBeGreaterThan(1000);
      fs.writeFileSync(screenshotTestPath, originalTest);
    },
  );
});
