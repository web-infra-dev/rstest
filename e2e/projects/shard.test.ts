import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = join(__dirname, 'fixtures');
const shardFiles = [
  'packages/client/test/App.test.tsx',
  'packages/client/test/index.test.ts',
  'packages/client/test/node.test.ts',
  'packages/client-vue/test/index.test.ts',
  'packages/node/test/index.test.ts',
  'packages/node/test/mockFs.test.ts',
];
const shardCases = [
  {
    index: 1,
    count: 2,
    files: [
      'packages/node/test/index.test.ts',
      'packages/client/test/App.test.tsx',
      'packages/client/test/node.test.ts',
    ],
  },
  {
    index: 2,
    count: 2,
    files: [
      'packages/client-vue/test/index.test.ts',
      'packages/node/test/mockFs.test.ts',
      'packages/client/test/index.test.ts',
    ],
  },
  { index: 3, count: 4, files: ['packages/node/test/mockFs.test.ts'] },
  { index: 4, count: 4, files: ['packages/client/test/index.test.ts'] },
];

describe('test projects sharding', () => {
  it.each(shardCases)(
    'runs hash-sorted shard $index of $count',
    async ({ index, count, files }) => {
      const { cli, expectExecSuccess, expectLog } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--shard',
          `${index}/${count}`,
          '--globals',
          ...shardFiles,
        ],
        options: { nodeOptions: { cwd: fixturesPath } },
      });

      await expectExecSuccess();
      expectLog(
        `Running shard ${index} of ${count} (${files.length} of 6 test files)`,
      );
      for (const testPath of shardFiles) {
        expect(cli.stdout.includes(testPath)).toBe(files.includes(testPath));
      }
      expect(cli.stdout).toMatch(
        new RegExp(`Test Files\\s+${files.length} passed`),
      );
    },
  );

  it.each(shardCases)(
    'lists hash-sorted shard $index of $count',
    async ({ index, count, files }) => {
      const { cli, expectExecSuccess, expectLog } = await runRstestCli({
        command: 'rstest',
        args: [
          'list',
          '--filesOnly',
          '--shard',
          `${index}/${count}`,
          ...shardFiles,
        ],
        options: { nodeOptions: { cwd: fixturesPath } },
      });

      await expectExecSuccess();
      expectLog(
        `Running shard ${index} of ${count} (${files.length} of 6 test files)`,
      );
      expect(
        cli.stdout
          .split('\n')
          .filter((line) => /\.test\.tsx?$/.test(line))
          .sort(),
      ).toEqual([...files].sort());
    },
  );

  it('should run failed on an empty shard', async () => {
    const { expectExecFailed, expectLog, expectStderrLog } = await runRstestCli(
      {
        command: 'rstest',
        args: ['run', '--shard', '7/7', '--globals', ...shardFiles],
        options: { nodeOptions: { cwd: fixturesPath } },
      },
    );

    await expectExecFailed();
    expectLog('Running shard 7 of 7 (0 of 6 test files)');
    expectStderrLog('No test files found, exiting with code 1.');
  });
});
