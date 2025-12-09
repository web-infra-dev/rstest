import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

rs.setConfig({
  retry: 3,
});

// Watch mode tests can be flaky, skip on Windows
describe.skipIf(process.platform === 'win32')('browser mode - watch', () => {
  it('should re-run tests on file change', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-browser-watch-test`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch`,
      fixturesTargetPath,
    });

    // Update port to avoid conflicts with other watch tests
    const configPath = path.join(fixturesTargetPath, 'rstest.config.ts');
    fs.update(configPath, (content) => {
      return content.replace('port: 5186', 'port: 5192');
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

    // Wait for initial run
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch(/Tests.*1.*passed/);

    // Modify test file
    cli.resetStd();
    const testFilePath = path.join(fixturesTargetPath, 'tests/index.test.ts');
    fs.update(testFilePath, (content) => {
      return content.replace("toBe('initial')", "toBe('modified')");
    });

    // Wait for re-run - test should fail now
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch(/fail/i);

    cli.exec.kill();
  });

  it('should handle new test file creation', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-browser-watch-create-test`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch`,
      fixturesTargetPath,
    });

    // Update port to avoid conflicts with other watch tests
    const configPath = path.join(fixturesTargetPath, 'rstest.config.ts');
    fs.update(configPath, (content) => {
      return content.replace('port: 5186', 'port: 5194');
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

    // Wait for initial run
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch(/Tests.*1.*passed/);

    // Create new test file
    cli.resetStd();
    const newTestPath = path.join(fixturesTargetPath, 'tests/new.test.ts');
    fs.create(
      newTestPath,
      `import { describe, expect, it } from '@rstest/core';
describe('new test', () => {
  it('should pass', () => {
    expect(true).toBe(true);
  });
});`,
    );

    // Wait for re-run with new file
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch(/Tests.*passed/);

    cli.exec.kill();
  });
});
