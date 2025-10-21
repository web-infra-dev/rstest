import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { expectFile, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test snapshot', () => {
  it('should generator snapshot file correctly with -u', async () => {
    const snapshotFilePath = join(
      __dirname,
      'fixtures/__snapshots__/index.test.ts.snap',
    );

    fs.rmSync(snapshotFilePath, {
      force: true,
    });

    await runRstestCli({
      command: 'rstest',
      args: ['run', '-u', 'fixtures/index.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectFile(snapshotFilePath, 3000);

    // should generator snapshot name correctly
    await expect
      .poll(() => fs.readFileSync(snapshotFilePath, 'utf-8'))
      .toContain(
        '[`test snapshot > test snapshot generate 1`] = `"hello world"`',
      );

    fs.rmSync(snapshotFilePath);
  });

  it('resolveSnapshotPath', async () => {
    const snapshotFilePath = join(__dirname, 'fixtures/index.test.ts.snap');

    fs.rmSync(snapshotFilePath, {
      force: true,
    });
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/index.test.ts',
        '-u',
        '-c',
        'fixtures/rstest.snapshotPath.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    await expectFile(snapshotFilePath, 3000);
  });

  describe('test snapshot file state', () => {
    it('test toMatchSnapshot API', () => {
      expect('hello world').toMatchSnapshot();
      expect('hello Rstest').toMatchSnapshot();
    });

    it('test toMatchSnapshot API', () => {
      // test repeat test case name
      expect('hello world 1').toMatchSnapshot();
    });

    it('test toMatchSnapshot API - 1', () => {
      expect('hello world - 1').toMatchSnapshot();
    });

    it('test toMatchSnapshot name', () => {
      expect('hi').toMatchSnapshot('say hi');
    });
  });

  it('test toMatchFileSnapshot correctly', async () => {
    await expect('hello world').toMatchFileSnapshot(
      '__snapshots__/file.output.txt',
    );
  });
});
