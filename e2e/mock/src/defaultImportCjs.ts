// Uses default import from a CJS module (node:path) for testing factory mock default interop
import path from 'node:path';

export function getBasename(filePath: string): string {
  return path.basename(filePath);
}

export function joinPaths(...paths: string[]): string {
  return path.join(...paths);
}
