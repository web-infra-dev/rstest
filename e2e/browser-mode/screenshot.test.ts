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

describe.sequential('browser mode - screenshot matching', () => {
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
    expect(parseJsonReport(firstRun.cli.stdout).snapshot.added).toBe(34);

    const projectDirs = fs.readdirSync(screenshotRoot);
    expect(projectDirs).toHaveLength(2);
    const screenshotDir = path.join(screenshotRoot, 'screenshot.test.ts');
    const screenshotNames = fs
      .readdirSync(screenshotDir)
      .filter((name) => name.endsWith('.png'))
      .sort();
    expect(screenshotNames).toHaveLength(15);
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
      name.startsWith('whole-page~'),
    );
    if (!pageScreenshotName) {
      throw new Error('Expected the full page screenshot reference.');
    }
    const pageScreenshot = fs.readFileSync(
      path.join(screenshotDir, pageScreenshotName),
    );
    expect(pageScreenshot.readUInt32BE(20)).toBeGreaterThan(1000);
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
    ).toHaveLength(15);
    expect(screenshotNames).toContain(
      `assigns-separate-references-to-repeated-unnamed-screenshots-1-chromium-${process.platform}.png`,
    );
    expect(screenshotNames).toContain(
      `assigns-separate-references-to-repeated-unnamed-screenshots-2-chromium-${process.platform}.png`,
    );
    expect(
      screenshotNames.some((name) =>
        new RegExp(
          `^Header~[a-f0-9]{64}-chromium-${process.platform}\\.png$`,
        ).test(name),
      ),
    ).toBe(true);
    expect(screenshotNames).toContain(
      `header-chromium-${process.platform}.png`,
    );
    expect(screenshotNames).toContain(
      `ordinal-collision-1-chromium-${process.platform}.png`,
    );
    expect(
      screenshotNames.some((name) =>
        new RegExp(
          `^ordinal-collision-1~[a-f0-9]{64}-chromium-${process.platform}\\.png$`,
        ).test(name),
      ),
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
      .find((name) => name.startsWith('primary-button'));
    if (!referenceName)
      throw new Error('Expected the screenshot reference to be generated.');
    expect(referenceName).toMatch(
      new RegExp(
        `^primary-button~[a-f0-9]{64}-chromium-${process.platform}\\.png$`,
      ),
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
    expect(parseJsonReport(matchingRun.cli.stdout).snapshot.matched).toBe(32);
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
          .find((name) => name.startsWith('primary-button'))!,
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

  it('saves a PNG for a failed test', async () => {
    const result = await runScreenshot(['tests/failure.test.ts']);
    await result.cli.exec;
    expect(result.cli.exec.exitCode).not.toBe(0);
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'captures the failed page state',
    );
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'expected true to be false',
    );

    const screenshotPath = fs
      .readdirSync(fixtureDir, { recursive: true })
      .map((entry) => path.join(fixtureDir, entry.toString()))
      .find((entry) =>
        /failure\.test\.ts-captures-the-failed-page-state-[a-f0-9]{16}\.png$/.test(
          entry,
        ),
      );
    expect(screenshotPath).toBeDefined();
    if (!screenshotPath)
      throw new Error('Failed-test screenshot was not saved.');
    expect(fs.readFileSync(screenshotPath).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it('can disable failed-test screenshots', async () => {
    const result = await runScreenshot([
      '--browser.screenshotFailures=false',
      'tests/failure.test.ts',
    ]);
    await result.cli.exec;
    expect(result.cli.exec.exitCode).not.toBe(0);
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'captures the failed page state',
    );
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'expected true to be false',
    );
    expect(
      fs
        .readdirSync(fixtureDir, { recursive: true })
        .some((entry) => entry.toString().endsWith('.png')),
    ).toBe(false);
  });

  it('removes screenshots when a retry passes', async () => {
    const result = await runScreenshot([
      '--retry=1',
      'tests/retry-pass.test.ts',
    ]);
    await result.expectExecSuccess();
    expect(
      fs
        .readdirSync(fixtureDir, { recursive: true })
        .some((entry) => entry.toString().endsWith('.png')),
    ).toBe(false);
  });

  it('saves a screenshot when teardown fails', async () => {
    const result = await runScreenshot(['tests/teardown-failure.test.ts']);
    await result.cli.exec;
    expect(result.cli.exec.exitCode).not.toBe(0);
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toContain(
      'fails in afterEach',
    );
    expect(
      fs
        .readdirSync(fixtureDir, { recursive: true })
        .some((entry) =>
          /teardown-failure\.test\.ts-fails-in-afterEach-[a-f0-9]{16}\.png$/.test(
            entry.toString(),
          ),
        ),
    ).toBe(true);
  });

  it('keeps references distinct across source files and normalized names', async () => {
    fs.writeFileSync(
      path.join(fixtureDir, 'rstest.shared-screenshots.config.mts'),
      `import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    expect: {
      toMatchScreenshot: {
        screenshotDirectory: path.join(import.meta.dirname, 'shared-screenshots'),
      },
    },
  },
  include: ['tests/a/example.test.ts', 'tests/b/example.test.ts'],
});
`,
    );
    for (const sourceDirectory of ['a', 'b']) {
      const sourcePath = path.join(fixtureDir, 'tests', sourceDirectory);
      fs.mkdirSync(sourcePath, { recursive: true });
      fs.writeFileSync(
        path.join(sourcePath, 'example.test.ts'),
        `import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('captures a shared name', async () => {
  document.body.innerHTML = '<button>Save</button>';
  const button = page.getByRole('button', { name: 'Save' });
  await expect(button).toMatchScreenshot('header');
  await expect(button).toMatchScreenshot('./header');
});
`,
      );
    }

    const firstRun = await runScreenshot([
      '--config=rstest.shared-screenshots.config.mts',
    ]);
    await firstRun.expectExecSuccess();
    const projectDirectories = fs.readdirSync(
      path.join(fixtureDir, 'shared-screenshots', '__projects__'),
    );
    expect(projectDirectories).toHaveLength(1);
    for (const sourceDirectory of ['a', 'b']) {
      const directory = path.join(
        fixtureDir,
        'shared-screenshots',
        '__projects__',
        projectDirectories[0]!,
        'tests',
        sourceDirectory,
        'example.test.ts',
      );
      expect(
        fs.readdirSync(directory).filter((name) => name.endsWith('.png')),
      ).toHaveLength(2);
    }

    const secondRun = await runScreenshot([
      '--config=rstest.shared-screenshots.config.mts',
    ]);
    await secondRun.expectExecSuccess();

    const relocatedFixture = fs.mkdtempSync(
      path.join(__dirname, 'fixtures-test-screenshot-relocated-'),
    );
    try {
      fs.cpSync(
        path.join(fixtureDir, 'rstest.shared-screenshots.config.mts'),
        path.join(relocatedFixture, 'rstest.shared-screenshots.config.mts'),
      );
      fs.cpSync(
        path.join(fixtureDir, 'tests'),
        path.join(relocatedFixture, 'tests'),
        { recursive: true },
      );
      fs.cpSync(
        path.join(fixtureDir, 'shared-screenshots'),
        path.join(relocatedFixture, 'shared-screenshots'),
        { recursive: true },
      );
      const relocatedRun = await runBrowserCliWithCwd(relocatedFixture, {
        args: [
          '--reporters=json',
          '--config=rstest.shared-screenshots.config.mts',
        ],
      });
      cliToKill = relocatedRun.cli;
      await relocatedRun.expectExecSuccess();
      expect(parseJsonReport(relocatedRun.cli.stdout).snapshot.added).toBe(0);
    } finally {
      fs.rmSync(relocatedFixture, { recursive: true, force: true });
    }
  }, 120_000);

  it('keeps custom resolver ordinals compatible for unnamed assertions', async () => {
    fs.writeFileSync(
      path.join(fixtureDir, 'rstest.resolver-ordinals.config.mts'),
      `import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    expect: {
      toMatchScreenshot: {
        resolveScreenshotPath: ({ screenshotAssertionOrdinal }) =>
          path.join('resolver-references', \`reference-\${screenshotAssertionOrdinal ?? 'first'}.png\`),
      },
    },
  },
  include: ['tests/resolver-ordinals.test.ts'],
});
`,
    );
    fs.writeFileSync(
      path.join(fixtureDir, 'tests', 'resolver-ordinals.test.ts'),
      `import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('captures two unnamed screenshots', async () => {
  document.body.innerHTML = '<button>Save</button>';
  const button = page.getByRole('button', { name: 'Save' });
  await expect(button).toMatchScreenshot();
  await expect(button).toMatchScreenshot();
});
`,
    );

    const args = ['--config=rstest.resolver-ordinals.config.mts'];
    const firstRun = await runScreenshot(args);
    await firstRun.expectExecSuccess();
    expect(
      fs.readdirSync(path.join(fixtureDir, 'resolver-references')),
    ).toEqual(['reference-2.png', 'reference-first.png']);
    const secondRun = await runScreenshot(args);
    await secondRun.expectExecSuccess();
  }, 120_000);

  it('stores references outside the test file when the directory is dot', async () => {
    const configPath = path.join(
      fixtureDir,
      'rstest.dot-screenshots.config.mts',
    );
    const dotConfig = `import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    expect: {
      toMatchScreenshot: { screenshotDirectory: '.' },
    },
  },
  include: ['tests/dot-directory.test.ts'],
});
`;
    fs.writeFileSync(configPath, dotConfig);
    const testPath = path.join(fixtureDir, 'tests', 'dot-directory.test.ts');
    fs.writeFileSync(
      testPath,
      `import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test('captures a screenshot', async () => {
  document.body.innerHTML = '<button>Save</button>';
  await expect(page.getByRole('button', { name: 'Save' })).toMatchScreenshot();
});
`,
    );

    const args = ['--config=rstest.dot-screenshots.config.mts'];
    const firstRun = await runScreenshot(args);
    await firstRun.expectExecSuccess();
    expect(fs.statSync(testPath).isFile()).toBe(true);
    expect(
      fs.readdirSync(
        path.join(
          fixtureDir,
          'tests',
          '__screenshots__',
          'dot-directory.test.ts',
        ),
      ),
    ).toEqual([`captures-a-screenshot-1-chromium-${process.platform}.png`]);
    const secondRun = await runScreenshot(args);
    await secondRun.expectExecSuccess();
    fs.writeFileSync(
      configPath,
      dotConfig
        .replace(
          "import { defineConfig } from '@rstest/core';",
          "import path from 'node:path';\nimport { defineConfig } from '@rstest/core';",
        )
        .replace(
          "screenshotDirectory: '.'",
          "screenshotDirectory: path.join(import.meta.dirname, 'tests')",
        ),
    );
    const absoluteRun = await runScreenshot(['--reporters=json', ...args]);
    await absoluteRun.expectExecSuccess();
    expect(parseJsonReport(absoluteRun.cli.stdout).snapshot.added).toBe(0);
    expect(fs.existsSync(path.join(fixtureDir, 'tests', '__projects__'))).toBe(
      false,
    );
  }, 120_000);

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
        new RegExp(
          `^global-default~[a-f0-9]{64}-chromium-${process.platform}\\.png$`,
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
      expect(
        fs.readdirSync(path.join(screenshotRoot, 'screenshot.test.ts')),
      ).toHaveLength(15);
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
      ).toHaveLength(15);
      for (const headedScreenshotDir of [
        path.join(screenshotRoot, 'screenshot.test.ts'),
        path.join(
          fixtureDir,
          'tests',
          'project-b-baselines',
          'screenshot.test.ts',
        ),
      ]) {
        const headedScreenshotNames = fs.readdirSync(headedScreenshotDir);
        const viewportScreenshotName = headedScreenshotNames.find((name) =>
          name.startsWith('headed-viewport~'),
        );
        if (!viewportScreenshotName) {
          throw new Error('Expected the headed viewport screenshot reference.');
        }
        const viewportScreenshot = fs.readFileSync(
          path.join(headedScreenshotDir, viewportScreenshotName),
        );
        expect(viewportScreenshot.readUInt32BE(16)).toBeGreaterThan(0);
        expect(viewportScreenshot.readUInt32BE(20)).toBeGreaterThan(0);
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
        "test('captures the full page after applying screenshot styles', async () => {",
        '  document.body.innerHTML = \'<main style="width: 400px; height: 100px"></main>\';',
        "  await expect(page).toMatchScreenshot('styled-full-page', { fullPage: true, style: 'body { min-height: 2000px !important; }' });",
        '});',
        "test('captures content added during full-page stability checks', async () => {",
        '  document.body.innerHTML = \'<main style="height: 100px"></main>\';',
        "  setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<section style=\"height: 2000px\"></section>'), 25);",
        "  await expect(page).toMatchScreenshot('async-full-page', { fullPage: true });",
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
      const screenshotDir = path.join(screenshotRoot, 'screenshot.test.ts');
      const wideScreenshot = fs
        .readdirSync(screenshotDir)
        .find((name) => name.startsWith('wide-full-page~'));
      if (!wideScreenshot) {
        throw new Error('Expected the wide full-page screenshot reference.');
      }
      const wideScreenshotBuffer = fs.readFileSync(
        path.join(screenshotDir, wideScreenshot),
      );
      expect(wideScreenshotBuffer.readUInt32BE(16)).toBeGreaterThan(1500);
      expect(wideScreenshotBuffer.readUInt32BE(20)).toBeGreaterThan(1000);
      const styledScreenshot = fs
        .readdirSync(screenshotDir)
        .find((name) => name.startsWith('styled-full-page~'));
      if (!styledScreenshot) {
        throw new Error('Expected the styled full-page screenshot reference.');
      }
      const styledScreenshotBuffer = fs.readFileSync(
        path.join(screenshotDir, styledScreenshot),
      );
      expect(styledScreenshotBuffer.readUInt32BE(20)).toBeGreaterThan(1900);
      const asyncScreenshot = fs
        .readdirSync(screenshotDir)
        .find((name) => name.startsWith('async-full-page~'));
      if (!asyncScreenshot) {
        throw new Error('Expected the async full-page screenshot reference.');
      }
      const asyncScreenshotBuffer = fs.readFileSync(
        path.join(screenshotDir, asyncScreenshot),
      );
      expect(asyncScreenshotBuffer.readUInt32BE(20)).toBeGreaterThan(1900);
      fs.writeFileSync(screenshotTestPath, originalTest);
    },
  );
});
