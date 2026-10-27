import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import { BROWSER_PORTS } from './fixtures/ports';
import { runBrowserCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - related', () => {
  it('should reject an invalid browser dependency graph before listing tests', async () => {
    const fixturesTargetPath = join(
      __dirname,
      'fixtures',
      'test-temp-related-error',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: join(__dirname, 'fixtures', 'related'),
      fixturesTargetPath,
    });
    onTestFinished(() => fs.delete(fixturesTargetPath));
    fs.update(
      join(fixturesTargetPath, 'tests/src/index.ts'),
      'export const sayHi = ;\n',
    );
    const { cli, expectExecFailed } = await runBrowserCliWithCwd(
      fixturesTargetPath,
      {
        command: 'list',
        args: [
          '--filesOnly',
          '--related',
          'tests/src/other.ts',
          '--passWithNoTests',
        ],
      },
    );
    await expectExecFailed();
    expect(cli.stderr).toContain(
      'Cannot select related tests because compilation failed',
    );
    expect(cli.stdout).not.toContain('tests/other.test.ts');
  });

  it('should list matched files without starting the browser server', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(BROWSER_PORTS.related, '127.0.0.1', resolve);
    });

    try {
      const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
        join(__dirname, 'fixtures', 'related'),
        { command: 'list', args: ['--filesOnly'] },
      );

      await expectExecSuccess();
      expect(cli.stdout).toContain('tests/index.test.ts');
      expect(cli.stdout).toContain('tests/other.test.ts');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('should filter browser tests by related source files', async () => {
    const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'related'),
      {
        command: 'list',
        args: ['--related', 'tests/src/index.ts', '--filesOnly'],
      },
    );

    await expectExecSuccess();

    expect(
      cli.stdout.split('\n').filter((line) => line.includes('.test.ts')),
    ).toEqual(['tests/index.test.ts']);
  });

  it('should not run the full browser suite when related finds no tests', async () => {
    const { cli, expectExecFailed } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'related'),
      { args: ['--related', 'tests/src/missing.ts'] },
    );

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'No test files found for related source files, exiting with code 1.',
    );
    expect(cli.log).toContain('related:');
    expect(cli.log).toContain('tests/src/missing.ts');
    expect(cli.log).not.toContain('index.test.ts');
    expect(cli.log).not.toContain('other.test.ts');
  });
});
