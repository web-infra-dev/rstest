import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const fixtureDir = fileURLToPath(
  new URL('./fixtures/bareImports', import.meta.url),
);

describe('direct side-effect imports', () => {
  for (const usedExports of [false, true]) {
    for (const concatenateModules of [false, true]) {
      it(`preserves registration without retaining other tests' barrels (usedExports=${usedExports}, concatenateModules=${concatenateModules})`, async () => {
        const result = await runRstestCli({
          command: 'rstest',
          args: ['run'],
          options: {
            nodeOptions: {
              cwd: fixtureDir,
              env: {
                USED_EXPORTS: String(usedExports),
                CONCAT: String(concatenateModules),
              },
            },
          },
        });
        await result.expectExecSuccess();
        expect(result.cli.stdout).toContain('2 passed');
      });
    }
  }

  for (const symlinks of [false, true]) {
    it(`protects test and setup imports through a directory symlink (resolve.symlinks=${symlinks})`, async () => {
      const target = join(
        fixtureDir,
        `../fixtures-test-bare-imports-symlink-${symlinks}`,
      );
      const { fs } = await prepareFixtures({
        fixturesPath: fixtureDir,
        fixturesTargetPath: target,
      });
      try {
        await symlink(fixtureDir, join(target, 'linked'), 'junction');
        fs.create(
          join(target, 'rstest.symlink.config.mts'),
          `
import { defineConfig } from '@rstest/core';
import config from './rstest.config.mts';
export default defineConfig({
  ...config,
  include: ['linked/*.test.js'],
  setupFiles: ['./linked/setup.js'],
  tools: { rspack: {
    resolve: { symlinks: ${symlinks} },
    optimization: { sideEffects: true, usedExports: true, concatenateModules: true },
  } },
});
`,
        );
        const result = await runRstestCli({
          command: 'rstest',
          args: ['run', '-c', 'rstest.symlink.config.mts'],
          options: { nodeOptions: { cwd: target } },
        });
        await result.expectExecSuccess();
        expect(result.cli.stdout).toContain('2 passed');
      } finally {
        fs.delete(target);
      }
    });
  }

  it('keeps direct import protection across cold and warm build cache runs', async () => {
    const target = join(fixtureDir, '../fixtures-test-bare-imports-cache');
    const { fs } = await prepareFixtures({
      fixturesPath: fixtureDir,
      fixturesTargetPath: target,
    });
    try {
      for (let run = 0; run < 2; run++) {
        const result = await runRstestCli({
          command: 'rstest',
          args: ['run'],
          options: {
            nodeOptions: {
              cwd: target,
              env: {
                BUILD_CACHE: 'true',
                USED_EXPORTS: 'true',
                CONCAT: 'true',
              },
            },
          },
        });
        await result.expectExecSuccess();
        expect(result.cli.stdout).toContain('2 passed');
      }
    } finally {
      fs.delete(target);
    }
  });

  it('protects newly discovered tests in watch mode', async () => {
    const target = join(fixtureDir, '../fixtures-test-bare-imports-node');
    const { fs } = await prepareFixtures({
      fixturesPath: fixtureDir,
      fixturesTargetPath: target,
    });
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch'],
      options: { nodeOptions: { cwd: target } },
    });
    try {
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('2 passed');
      cli.resetStd();
      fs.create(
        join(target, 'added.test.js'),
        `
import { test, expect } from '@rstest/core';
import './registration.js';
import { answer } from './answer.js';
test('new direct import', () => expect(answer()).toBe('test mock'));
`,
      );
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('added.test.js');
      expect(cli.stdout).not.toContain('failed');
    } finally {
      await cli.killProcessTree();
      fs.delete(target);
    }
  });
});
