import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test build config', () => {
  it.concurrent.for([
    { name: 'define' },
    { name: 'alias' },
    { name: 'plugin' },
    { name: 'tools/rspack' },
    { name: 'decorators' },
  ])(
    '$name config should work correctly',
    async ({ name }, { onTestFinished }) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          `fixtures/${name}`,
          '-c',
          `fixtures/${name}/rstest.config.ts`,
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: __dirname,
          },
        },
      });

      await expectExecSuccess();
    },
  );
});
