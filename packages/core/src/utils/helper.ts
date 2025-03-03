import { isAbsolute, join } from 'node:path';
import color from 'picocolors';

export function getAbsolutePath(base: string, filepath: string): string {
  return isAbsolute(filepath) ? filepath : join(base, filepath);
}

export { color };
