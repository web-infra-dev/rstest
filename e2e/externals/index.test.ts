import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';
import { copyFixturePackage } from './copyFixturePackage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test externals', () => {
  beforeAll(() => {
    copyFixturePackage(
      join(__dirname, './fixtures/test-bundle'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-bundle'),
    );
    copyFixturePackage(
      join(__dirname, './fixtures/test-module-field'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-module-field'),
    );
  });

  it('should external node_modules by default, bundle TypeScript packages and resolve the module field', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/index.test.ts',
        './fixtures/bundle.test.ts',
        './fixtures/moduleField',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'node_modules are externalized by default').toMatch(
      /✓ fixtures\/index\.test\.ts \(5\)/,
    );
    expect(
      cli.stdout,
      'TypeScript package test-bundle is bundled and loads',
    ).toMatch(/✓ fixtures\/bundle\.test\.ts \(1\)/);
    expect(
      cli.stdout,
      'module-field pkg resolves via import and require in node env',
    ).toMatch(/✓ fixtures\/moduleField\.test\.ts \(2\)/);
    await expectExecSuccess();
  });
});
