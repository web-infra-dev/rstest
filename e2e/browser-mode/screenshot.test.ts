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
      'tests/screenshot.test.ts',
      'tests/concurrent-screenshot.test.ts',
    ]);
    await firstRun.expectExecSuccess();

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
      ).toHaveLength(1);
    }
    const originalReference = fs.readFileSync(referencePath);
    expect(originalReference.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );

    const matchingRun = await runScreenshot(['tests/screenshot.test.ts']);
    await matchingRun.expectExecSuccess();
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
  });

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
`,
    );

    const result = await runScreenshot(['tests/invalid-options.test.ts']);
    await result.cli.exec;
    expect(result.cli.exec.exitCode).toBe(1);
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'threshold must be between 0 and 1',
    );
    expect(
      fs.existsSync(path.join(fixtureDir, 'tests', '__screenshots__')),
    ).toBe(false);
  });

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
      for (const project of ['project-a', 'project-b']) {
        const projectDir = projectDirs.find((name) =>
          name.startsWith(`${project}-`),
        );
        if (!projectDir) {
          throw new Error(`Expected screenshot directory for ${project}.`);
        }
        expect(
          fs.readdirSync(
            path.join(screenshotRoot, projectDir, 'screenshot.test.ts'),
          ),
        ).toHaveLength(2);
        expect(
          fs.readdirSync(
            path.join(
              screenshotRoot,
              projectDir,
              'concurrent-screenshot.test.ts',
            ),
          ),
        ).toHaveLength(1);
      }
    },
  );
});
