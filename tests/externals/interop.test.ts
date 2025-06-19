import { dirname, join } from 'node:path';
import fse from 'fs-extra';

import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test interop', () => {
  beforeAll(() => {
    fse.copySync(
      join(__dirname, './fixtures/test-interop'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-interop'),
    );
  });

  it('should interopDefault correctly in jsdom test environment', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/interop', '--testEnvironment=jsdom'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);
  });

  it('should not interopDefault in node test environment', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/interop', '--testEnvironment=node'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
  });
});
