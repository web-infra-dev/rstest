import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test build config', () => {
  it.each([
    { name: 'define' },
    { name: 'alias' },
    { name: 'plugin' },
    { name: 'tools/rspack' },
    { name: 'decorators' },
  ])('$name config should work correctly', async ({ name }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        `fixtures/${name}/index.test.ts`,
        '-c',
        `fixtures/${name}/rstest.config.ts`,
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);
  });
});
