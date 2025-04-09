import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test snapshot file state', () => {
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

    expect(fs.existsSync(snapshotFilePath)).toBeTruthy();

    const content = fs.readFileSync(snapshotFilePath, 'utf-8');

    // should generator snapshot name correctly
    expect(content).toContain(
      '[`test toMatchSnapshot API 1`] = `"hello world"`',
    );
    expect(content).toContain(
      '[`test toMatchSnapshot API 2`] = `"hello Rstest"`',
    );
    expect(content).toContain(
      '[`test toMatchSnapshot API 3`] = `"hello world 1"`',
    );

    expect(content).toContain(
      '[`test toMatchSnapshot API - 1 1`] = `"hello world - 1"`',
    );
    expect(content).toContain(
      '[`test toMatchSnapshot name > say hi 1`] = `"hi"`',
    );

    fs.rmSync(snapshotFilePath);
  });

  it('should failed when snapshot unmatched', async () => {
    const process = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fail.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    expect(process.exitCode).toBe(1);

    const logs = process.stdout.split('\n');

    expect(
      logs.find((log) =>
        log.includes(
          'Snapshot `should failed when snapshot unmatched 1` mismatched',
        ),
      ),
    ).toBeTruthy();
  });

  it('test toMatchFileSnapshot correctly', async () => {
    expect('hello world').toMatchFileSnapshot('__snapshots__/file.output.txt');
  });
});
