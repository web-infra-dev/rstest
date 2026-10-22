import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { x } from 'tinyexec';

const fixtureDir = join(__dirname, 'fixtures/published-declarations');

describe('published declarations', () => {
  it.for([
    { config: 'tsconfig.json' },
    { config: 'tsconfig.jest-matchers.json' },
  ])('$config should type-check', async ({ config }) => {
    const { exitCode, stderr, stdout } = await x(
      'pnpm',
      ['exec', 'rstest', 'run'],
      {
        throwOnError: false,
        nodeOptions: {
          cwd: fixtureDir,
          env: {
            ...process.env,
            TYPE_TEST_JEST_MATCHERS: config.includes('jest-matchers')
              ? 'true'
              : '',
          },
        },
      },
    );

    expect(exitCode, `${stdout}${stderr}`).toBe(0);
  });
});
