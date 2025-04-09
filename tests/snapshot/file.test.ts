import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test snapshot file state', () => {
  it('should generator snapshot file correctly', async () => {
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

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, 100);
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
});
