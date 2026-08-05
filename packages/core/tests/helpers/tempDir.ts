import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const withTempDir = async <T>(
  prefix: string,
  callback: (directory: string) => T | Promise<T>,
): Promise<T> => {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  try {
    return await callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
