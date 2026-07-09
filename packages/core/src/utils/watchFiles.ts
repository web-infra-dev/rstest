import type { ChokidarOptions, FSWatcher } from 'chokidar';

const GLOB_REGEX = /[*?{}[\]()!@+|]/;
/**
 * A simple glob pattern checker.
 * This can help us to avoid unnecessary tinyglobby import and call.
 */
const isGlob = (str: string): boolean => GLOB_REGEX.test(str);

export async function createChokidar(
  pathOrGlobs: string[],
  root: string,
  options: ChokidarOptions,
): Promise<FSWatcher> {
  const chokidar = await import('chokidar');

  const watchFiles = new Set<string>();

  const globPatterns = pathOrGlobs.filter((pathOrGlob) => {
    if (isGlob(pathOrGlob)) {
      return true;
    }
    watchFiles.add(pathOrGlob);
    return false;
  });

  if (globPatterns.length) {
    const { glob } = await import('tinyglobby');
    const files = await glob(globPatterns, {
      cwd: root,
      absolute: true,
    });
    for (const file of files) {
      watchFiles.add(file);
    }
  }

  return chokidar.watch(Array.from(watchFiles), options);
}
