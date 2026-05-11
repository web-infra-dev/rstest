import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const collectLifecycleEvents = (stdout: string) =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[lifecycle]'));

describe('fixture scopes', () => {
  it('builder syntax: file-scoped fixture is set up once and cleaned up at end of file', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/extend.scope.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();

    // - `setup db` fires exactly once (first test that consumes it).
    // - `setup counter` fires per-test (test scope, two tests consume it).
    // - `afterAll` fires after the last test but before the file fixture
    //   cleanup (matching Vitest semantics).
    // - `cleanup db` fires once, at the end of the file.
    expect(collectLifecycleEvents(cli.stdout)).toEqual([
      '[lifecycle] setup db',
      '[lifecycle] setup counter',
      '[lifecycle] cleanup counter',
      '[lifecycle] setup counter',
      '[lifecycle] cleanup counter',
      '[lifecycle] afterAll',
      '[lifecycle] cleanup db',
    ]);
  });

  it('object syntax: file-scoped use-callback fixture runs setup/teardown once', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/extend.scope.objectSyntax.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();

    expect(collectLifecycleEvents(cli.stdout)).toEqual([
      '[lifecycle] setup pool',
      '[lifecycle] use test 1',
      '[lifecycle] use test 2',
      '[lifecycle] teardown pool',
    ]);
  });
});
