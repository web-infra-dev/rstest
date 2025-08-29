import * as fs from 'node:fs';

export function readSomeFile(path: string) {
  return fs?.readFileSync?.(path, 'utf-8');
}
