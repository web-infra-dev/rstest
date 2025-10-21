import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe('test singleton', () => {
  beforeAll(async () => {
    fs.ensureDirSync(join(__dirname, 'fixtures', 'node_modules'));
    fs.writeFileSync(
      join(__dirname, 'fixtures', 'node_modules', 'c.mjs'),
      `
    let c = undefined;

export const getC = () => {
  if (!c) {
    c = Math.ceil(Math.random() * 1000).toString();
  }
  return c;
};
`,
    );
  });

  it('should load singleton module correctly', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should load singleton module correctly when TestNoIsolate is true', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            TestNoIsolate: 'true',
          },
        },
      },
    });

    await expectExecSuccess();
  });
});
