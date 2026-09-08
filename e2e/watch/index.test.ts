import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

rs.setConfig({
  retry: 3,
});

const allTestFiles = ['index.test.ts', 'other.test.ts'];

/**
 * Extract the "Test files to re-run" section from stdout.
 * Only check this section to avoid false positives from delayed error output
 * (e.g., GitHub Actions reporter output that arrives after resetStd).
 */
const getRerunSection = (stdout: string): string => {
  const match = stdout.match(/Test files to re-run.*?:\n([\s\S]*?)\n\n/);
  return match?.[1] ?? '';
};

const expectRerun = (
  stdout: string,
  expected: string[],
  all = allTestFiles,
) => {
  const rerunSection = getRerunSection(stdout);
  for (const file of expected) {
    expect(rerunSection).toMatch(file);
  }
  for (const file of all.filter((f) => !expected.includes(f))) {
    expect(rerunSection).not.toMatch(file);
  }
};

// TODO: The following error occurs only on Windows CI. It should appear in the Rspack version range from 1.5.0 to 1.6.0-beta.0.
// Error: EBUSY: resource busy or locked, rmdir 'D:\a\rstest\rstest\e2e\watch\fixtures-test-0'
describe.skipIf(process.platform === 'win32')('watch', () => {
  it('invalidates vmThreads source and setup caches after rebuilds', async ({
    onTestFinished,
  }) => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-vm-threads${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;
    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath,
    });
    fs.update(path.join(fixturesTargetPath, 'rstest.setup.ts'), (content) =>
      content.concat(
        "\n(globalThis as typeof globalThis & { __RSTEST_SETUP_VALUE__: string }).__RSTEST_SETUP_VALUE__ = 'initial';\n",
      ),
    );
    for (const testFile of allTestFiles) {
      fs.update(path.join(fixturesTargetPath, testFile), (content) =>
        content.concat(
          "\nit('observes the latest setup module', () => {\n  expect((globalThis as typeof globalThis & { __RSTEST_SETUP_VALUE__: string }).__RSTEST_SETUP_VALUE__).toBe('initial');\n});\n",
        ),
      );
    }
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'watch',
        '--pool',
        'vmThreads',
        '--pool.maxWorkers',
        '2',
        '--pool.memoryLimit',
        '256MB',
        '--disableConsoleIntercept',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 4 passed');

    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/shared.ts'), (content) =>
      content.replace('Hello,', 'Hi,'),
    );

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 2 failed');
    expect(cli.stdout).toMatch('Hi, index!');
    expect(cli.stdout).toMatch('Hi, other!');

    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/shared.ts'), (content) =>
      content.replace('Hi,', 'Hello,'),
    );

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 4 passed');

    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'rstest.setup.ts'), (content) =>
      content.replace("= 'initial'", "= 'modified'"),
    );

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 2 failed');
    expect(cli.stdout).toMatch('modified');

    cli.exec.kill();
  });

  it('should rerun only affected test files when source changes', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-0${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          env: { DEBUG: 'rstest' },
          cwd: fixturesTargetPath,
        },
      },
    });

    // Initial run
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 2 passed');
    expect(cli.stdout).toMatch('Run all tests in project');
    expect(cli.stdout).toMatch('[beforeAll] setup');
    expect(cli.stdout).toMatch('[afterAll] setup');
    expect(cli.stdout).not.toMatch('Test files to re-run');

    // Modify src/index.ts (leaf): only index.test.ts reruns
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/index.ts'), (content) => {
      return content.replace("greet('index')", "greet('INDEX')");
    });

    await cli.waitForStdout('Duration');
    expectRerun(cli.stdout, ['index.test.ts']);

    // Modify src/other.ts (leaf): only other.test.ts reruns
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/other.ts'), (content) => {
      return content.replace("greet('other')", "greet('OTHER')");
    });

    await cli.waitForStdout('Duration');
    expectRerun(cli.stdout, ['other.test.ts']);

    // Modify src/shared.ts (shared): both test files rerun
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/shared.ts'), () => {
      return 'export const greet = (name: string) => `Hi, ${name}!`;';
    });

    await cli.waitForStdout('Duration');
    expectRerun(cli.stdout, ['index.test.ts', 'other.test.ts']);

    // Modify the setup file: everything reruns, and the setup hooks
    // re-execute with the new content. (The shared edit above changed the
    // greeting, so this cycle's tests fail — the rerun scope and the modified
    // hook output are what this step pins, not the verdict.)
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'rstest.setup.ts'), (content) => {
      return content.replace(
        "console.log('[beforeAll] setup')",
        "console.log('[beforeAll] setup - modified')",
      );
    });

    await cli.waitForStdout('Duration');
    expectRerun(cli.stdout, ['index.test.ts', 'other.test.ts']);
    expect(cli.stdout).toMatch('[beforeAll] setup - modified');

    cli.exec.kill();
  });

  it('should rerun only affected test files with dynamic imports', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-dynamic${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;

    const { fs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, '../fixtures/fan-out-dynamic'),
      fixturesTargetPath,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          env: { DEBUG: 'rstest' },
          cwd: fixturesTargetPath,
        },
      },
    });

    // Initial run
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 2 passed');
    expect(cli.stdout).toMatch('Run all tests in project');

    // Modify src/late.ts (leaf): only index.test.ts reruns
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/late.ts'), (content) => {
      return content.replace("transform('late')", "transform('LATE')");
    });

    await cli.waitForStdout('Duration');
    expectRerun(cli.stdout, ['index.test.ts']);

    // Modify src/other.ts (leaf): only other.test.ts reruns
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/other.ts'), (content) => {
      return content.replace("transform('other')", "transform('OTHER')");
    });

    await cli.waitForStdout('Duration');
    expectRerun(cli.stdout, ['other.test.ts']);

    // Modify src/shared.ts (shared): both test files rerun
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/shared.ts'), () => {
      return 'export const transform = (value: string) => value.toLowerCase();';
    });

    await cli.waitForStdout('Duration');
    expectRerun(cli.stdout, ['index.test.ts', 'other.test.ts']);

    cli.exec.kill();
  });
});
