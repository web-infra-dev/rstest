import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

rs.setConfig({
  retry: 3,
});

describe('watch', () => {
  it('test files should be ran when create / update / delete', async () => {
    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath: `${__dirname}/fixtures-test-0`,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          env: { DEBUG: 'rstest' },
          cwd: `${__dirname}/fixtures-test-0`,
        },
      },
    });

    // initial
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 passed');
    expect(cli.stdout).not.toMatch('Test files to re-run:');
    expect(cli.stdout).toMatch('Run all tests in project');

    // create
    cli.resetStd();
    fs.create(
      './fixtures-test-0/bar.test.ts',
      `import { describe, expect, it } from '@rstest/core';
       describe('bar', () => {
         it('bar should be to bar', () => {
           expect('bar').toBe('bar');
         });
       });`,
    );

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 2 passed');
    expect(cli.stdout).toMatch(/Test files to re-run.*:\n.*bar\.test\.ts\n\n/);

    // update
    cli.resetStd();
    fs.update('./fixtures-test-0/bar.test.ts', (content) => {
      return content.replace("toBe('bar')", "toBe('BAR')");
    });

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 1 failed');
    expect(cli.stdout).toMatch('✗ bar > bar should be to bar');
    expect(cli.stdout).toMatch(/Test files to re-run.*:\n.*bar\.test\.ts\n\n/);

    // delete
    cli.resetStd();
    fs.delete('./fixtures-test-0/bar.test.ts');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('No test files need re-run.');
    expect(cli.stdout).toMatch('Test Files 1 passed');

    cli.exec.kill();
  });
});
