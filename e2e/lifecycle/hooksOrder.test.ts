import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('hooks order', () => {
  it('beforeAll, beforeEach, afterEach and afterAll run in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      // Quoted filters match exact paths, so the `error/*` fixtures (which
      // print the same hook prefixes) are excluded.
      args: [
        'run',
        '"afterAll.test.ts"',
        '"afterEach.test.ts"',
        '"beforeAll.test.ts"',
        '"beforeEach.test.ts"',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(cli.stdout, 'afterAll fixture passes').toMatch(
      /✓ afterAll\.test\.ts/,
    );
    expect(
      logs.filter((log) => log.startsWith('[afterAll]')),
      'afterAll hooks run innermost-first',
    ).toEqual([
      '[afterAll] in level B-A',
      '[afterAll] in level B-B',
      '[afterAll] in level A',
      '[afterAll] root',
    ]);

    expect(cli.stdout, 'afterEach fixture passes').toMatch(
      /✓ afterEach\.test\.ts/,
    );
    expect(
      logs.filter((log) => log.startsWith('[afterEach]')),
      'afterEach hooks run innermost-first per test',
    ).toEqual([
      '[afterEach] in level A',
      '[afterEach] root',

      '[afterEach] in level B-A',
      '[afterEach] in level A',
      '[afterEach] root',

      '[afterEach] in level B-B',
      '[afterEach] in level A',
      '[afterEach] root',
    ]);

    expect(cli.stdout, 'beforeAll fixture passes (ctx.filepath check)').toMatch(
      /✓ beforeAll\.test\.ts/,
    );
    expect(
      logs.filter((log) => log.startsWith('[beforeAll]')),
      'beforeAll hooks run outermost-first, async awaited',
    ).toEqual([
      '[beforeAll] root',
      '[beforeAll] root async',
      '[beforeAll] in level A',
      '[beforeAll] in level B-A',
      '[beforeAll] in level B-B',
    ]);

    expect(
      cli.stdout,
      'beforeEach fixture passes (ctx.task.name check)',
    ).toMatch(/✓ beforeEach\.test\.ts/);
    expect(
      logs.filter((log) => log.startsWith('[beforeEach]')),
      'beforeEach hooks run outermost-first per test',
    ).toEqual([
      '[beforeEach] root',
      '[beforeEach] root async',
      '[beforeEach] in level A',

      '[beforeEach] root',
      '[beforeEach] root async',
      '[beforeEach] in level A',
      '[beforeEach] in level B-A',

      '[beforeEach] root',
      '[beforeEach] root async',
      '[beforeEach] in level A',
      '[beforeEach] in level B-B',
    ]);
  });
});
