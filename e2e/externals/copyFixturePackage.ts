import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { threadId } from 'node:worker_threads';
import fse from 'fs-extra';

const newestMtime = (dir: string): number => {
  let newest = fs.statSync(dir).mtimeMs;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory()
        ? newestMtime(entryPath)
        : fs.statSync(entryPath).mtimeMs,
    );
  }
  return newest;
};

/**
 * Install a fixture package directory at `dest`.
 * Several test files in this directory install the same package from
 * parallel workers, which share one process under `--pool.type threads`.
 * An overwriting copy unlinks files another worker is still copying or
 * reading, so copy into a temp dir unique to this call and rename it into
 * place. An existing copy is kept unless the source changed after it was made.
 * Freshness is checked again after copying, so a worker that loses the race
 * keeps the fresh copy another worker installed instead of replacing it while
 * that worker's CLI may be reading it.
 */
export const copyFixturePackage = (source: string, dest: string) => {
  const isFresh = () => {
    let destMtime: number;
    try {
      destMtime = fs.statSync(dest).mtimeMs;
    } catch (error) {
      // Another worker can move `dest` aside between any two calls.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
    return destMtime >= newestMtime(source);
  };
  if (isFresh()) {
    return;
  }
  const unique = `${process.pid}-${threadId}-${randomUUID()}`;
  const tmp = `${dest}.${unique}.tmp`;
  fse.copySync(source, tmp);
  fs.mkdirSync(dirname(dest), { recursive: true });
  if (isFresh()) {
    fse.removeSync(tmp);
    return;
  }
  if (fs.existsSync(dest)) {
    // Stale copy: move it aside first, since rename cannot replace a
    // non-empty directory.
    const stale = `${dest}.${unique}.stale`;
    try {
      fs.renameSync(dest, stale);
      fse.removeSync(stale);
    } catch {
      // Another worker already moved it.
    }
  }
  try {
    fs.renameSync(tmp, dest);
  } catch (error) {
    fse.removeSync(tmp);
    if (!isFresh()) {
      throw error;
    }
  }
};
