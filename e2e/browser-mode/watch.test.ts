import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - watch', () => {
  it('test files should be ran when create / update / rename / delete', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-browser-watch`;

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

    // ========== Initial Run ==========
    // Initial run outputs full summary with Duration
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 1 passed');

    const newTestPath = path.join(fixturesTargetPath, 'tests/new.test.ts');
    const renamedTestPath = path.join(
      fixturesTargetPath,
      'tests/renamed.test.ts',
    );

    // ========== Create: Add new test file ==========
    cli.resetStd();
    fs.create(
      newTestPath,
      `import { describe, expect, it } from '@rstest/core';
describe('new test', () => {
  it('should pass', () => {
    expect('new').toBe('new');
  });
});`,
    );

    // In browser watch mode, re-runs show test file results but not full summary
    // Wait for the new test file to appear in output
    await cli.waitForStdout('✓ tests/new.test.ts');
    expect(cli.stdout).toMatch('new.test.ts');

    // ========== Update (break): Modify new test file to fail ==========
    cli.resetStd();
    fs.update(newTestPath, (content) => {
      return content.replace("toBe('new')", "toBe('modified')");
    });

    // Wait for failure output (error message appears in stderr for browser mode)
    await cli.waitForStderr("expected 'new' to be 'modified'");
    expect(cli.stdout).toMatch('✗ new test > should pass');

    // ========== Update (fix): Fix the test file ==========
    cli.resetStd();
    fs.update(newTestPath, (content) => {
      return content.replace("toBe('modified')", "toBe('new')");
    });

    // Wait for test to pass again
    await cli.waitForStdout('✓ tests/new.test.ts');

    // ========== Rename: Rename new.test.ts to renamed.test.ts ==========
    cli.resetStd();
    fs.rename(newTestPath, renamedTestPath);

    // Wait for renamed file to appear, original file should not appear
    await cli.waitForStdout('✓ tests/renamed.test.ts');
    expect(cli.stdout).not.toMatch('new.test.ts');

    // ========== Delete: Remove the renamed test file ==========
    cli.resetStd();
    fs.delete(renamedTestPath);

    // Wait for re-run after delete - should only show original test file
    await cli.waitForStdout('✓ tests/index.test.ts');
    // The deleted file should not appear in this run's output
    expect(cli.stdout).not.toMatch('renamed.test.ts');

    cli.exec.kill();
  });
});
