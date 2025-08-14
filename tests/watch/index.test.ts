import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('watch', () => {
  it('test files should be ran when create / update / delete', async () => {
    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          cwd: `${__dirname}/fixtures-test`,
        },
      },
    });

    // initial
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 passed');

    // create
    cli.resetStd();
    fs.create(
      './fixtures-test/bar.test.ts',
      `import { describe, expect, it } from '@rstest/core';
       describe('bar', () => {
         it('bar should be to bar', () => {
           expect('bar').toBe('bar');
         });
       });`,
    );

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 2 passed');

    // update
    cli.resetStd();
    fs.update('./fixtures-test/bar.test.ts', (content) => {
      return content.replace("toBe('bar')", "toBe('BAR')");
    });

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 1 failed | 1 passed');
    expect(cli.stdout).toMatch('✗ bar > bar should be to bar');

    // delete
    cli.resetStd();
    fs.delete('./fixtures-test/bar.test.ts');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 1 passed');

    cli.exec.kill();
  });
});
