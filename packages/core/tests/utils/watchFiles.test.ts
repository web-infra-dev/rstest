import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { createChokidar } from '../../src/utils/watchFiles';
import { withTempDir } from '../helpers/tempDir';

describe('createChokidar', () => {
  it('resolves when nothing matched, instead of awaiting a `ready` that never comes', async () => {
    await withTempDir('rstest-watch-files-', async (directory) => {
      const watcher = await createChokidar(
        [join(directory, 'missing-*.config.ts')],
        directory,
        { ignoreInitial: true },
      );

      await watcher.close();
    });
  });

  it('awaits the initial scan before returning a watcher', async () => {
    await withTempDir('rstest-watch-files-', async (directory) => {
      const configFile = join(directory, 'rstest.config.ts');
      writeFileSync(configFile, '');

      const watcher = await createChokidar([configFile], directory, {
        ignoreInitial: true,
      });

      expect(Object.keys(watcher.getWatched())).not.toHaveLength(0);

      await watcher.close();
    });
  });
});
