import { isAbsolute, join } from 'node:path';
import color from 'picocolors';

export function getAbsolutePath(base: string, filepath: string): string {
  return isAbsolute(filepath) ? filepath : join(base, filepath);
}

export const isPlainObject = (obj: unknown): obj is Record<string, any> => {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    Object.getPrototypeOf(obj) === Object.prototype
  );
};

export function formatError(error: unknown): Error | string {
  if (typeof error === 'string' || error instanceof Error) {
    return error;
  }

  if (isPlainObject(error) && error.message) {
    const e = new Error(error.name || 'unknown error');
    e.message = error.message;
    e.stack = error.stack;

    return e;
  }

  return String(error);
}

export { color };
