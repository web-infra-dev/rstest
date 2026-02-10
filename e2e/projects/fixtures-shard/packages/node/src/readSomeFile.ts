import { readFileSync } from 'node:fs';

export function readSomeFile(path: string) {
  return readFileSync(path, 'utf-8');
}
