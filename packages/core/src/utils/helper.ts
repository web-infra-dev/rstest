import { normalize as nativeNormalize } from 'node:path';
import {
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from 'pathe';
import type { RuntimeConfig, TestResult } from '../types';
import { TEST_DELIMITER } from './constants';
import { color } from './logger';
import { wrapRegex } from './regexpWireFormat';

/**
 * Generate a stable hash for a file path.
 * Uses FNV-1a to produce a 10-char hex string.
 */
export function generateFilePathHash(
  project: string,
  testPath: string,
): string {
  const str = `${project}\0${testPath}`;

  // FNV-1a 32-bit hash, produce 10 hex chars by combining two rounds
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  for (let i = str.length - 1; i >= 0; i--) {
    h2 ^= str.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }

  // Combine to get 10 hex chars
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return (hex1 + hex2).slice(0, 10);
}

export const formatRootStr = (rootStr: string, root: string): string => {
  return rootStr.includes('<rootDir>')
    ? normalize(rootStr.replace('<rootDir>', normalize(root)))
    : rootStr;
};

export function getAbsolutePath(base: string, filepath: string): string {
  return isAbsolute(filepath) ? filepath : join(base, filepath);
}

/**
 * Render a path relative to `rootPath` when it lives inside the root, otherwise
 * fall back to the original path. Used for trace labels and summary tables so
 * in-repo files show as short relative paths while external/sentinel paths
 * (e.g. `<host>`) pass through unchanged.
 */
export const displayPath = (filePath: string, rootPath: string): string => {
  const rel = relative(rootPath, resolve(rootPath, filePath));
  return rel && !rel.startsWith('..') ? rel : filePath;
};

/**
 * Convert a path to the OS-native separator form (`\` on Windows, no-op on
 * POSIX). Internally `testPath` stays POSIX so the pathe-based consumers
 * (snapshot, reporter relative paths, related-graph lookup) keep working, but
 * the user-facing surfaces (`expect.getState().testPath`, hook `ctx.filepath`)
 * must match `import.meta.filename`/`__filename`, which the rspack plugin
 * injects in native form. Apply this only at those user-facing boundaries.
 * See https://github.com/web-infra-dev/rstest/issues/1465.
 */
export const toNativePath = (filePath: string): string =>
  nativeNormalize(filePath);

export const parsePosix = (filePath: string): { dir: string; base: string } => {
  const { dir, base } = parse(filePath);

  return {
    dir: dir.split(sep).join('/'),
    base,
  };
};

export const isObject = (obj: unknown): obj is Record<string, any> =>
  Object.prototype.toString.call(obj) === '[object Object]';

export const castArray = <T>(arr?: T | T[]): T[] => {
  if (arr === undefined) {
    return [];
  }
  return Array.isArray(arr) ? arr : [arr];
};

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

export const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

export const prettyTime = (milliseconds: number): string => {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }

  const seconds = milliseconds / 1000;

  const getSecond = (seconds: number, needDigits?: boolean) => {
    if (!needDigits || seconds === Math.ceil(seconds)) {
      return `${Math.round(seconds).toString()}s`;
    }
    const digits = seconds < 10 ? (seconds >= 0.01 ? 2 : 3) : 1;
    return `${seconds.toFixed(digits)}s`;
  };

  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const secondsRemainder = minutes > 0 ? roundedSeconds % 60 : seconds;
  let time = '';

  if (minutes > 0) {
    time += `${minutes}m`;
  }

  if (secondsRemainder > 0) {
    if (minutes > 0) {
      time += ' ';
    }
    time += getSecond(secondsRemainder, !minutes);
  }
  return time;
};

const getTaskNames = (
  test: Pick<TestResult, 'name' | 'parentNames'>,
): string[] => (test.parentNames || []).concat(test.name).filter(Boolean);

export const getTaskNameWithPrefix = (
  test: Pick<TestResult, 'name' | 'parentNames'>,
  delimiter: string = TEST_DELIMITER,
): string => getTaskNames(test).join(delimiter ? ` ${delimiter} ` : ' ');

/**
 * Single source of truth for the `file:` task-id grammar. The value is an
 * opaque pass-through label (never equality-checked across processes), so the
 * grammar only needs to stay self-consistent — owning it here keeps the worker,
 * pool, and runner copies from drifting.
 *
 * The browser package keeps its own copy on purpose (it must not import core
 * runtime internals across the provider-agnostic barrier).
 */
export const getFileTaskId = (testPath: string): string => `file:${testPath}`;

/**
 * Makes some special types that are not supported for passing into the pool serializable.
 * eg. RegExp
 */
export const serializableConfig = <
  T extends Pick<RuntimeConfig, 'testNamePattern'>,
>(
  normalizedConfig: T,
): T => {
  const { testNamePattern } = normalizedConfig;
  return {
    ...normalizedConfig,
    testNamePattern:
      testNamePattern && typeof testNamePattern !== 'string'
        ? wrapRegex(testNamePattern)
        : testNamePattern,
  };
};

export type NodeVersion = {
  major: number;
  minor: number;
  patch: number;
};

export const getNodeVersion = (): NodeVersion => {
  if (typeof process.versions?.node === 'string') {
    const [major = 0, minor = 0, patch = 0] = process.versions.node
      .split('.')
      .map(Number);
    return { major, minor, patch };
  }
  return { major: 0, minor: 0, patch: 0 };
};

export const needFlagExperimentalDetectModule = (): boolean => {
  const { major, minor } = getNodeVersion();
  // `--experimental-detect-module` is introduced in Node.js 20.10.0.
  if (major === 20 && minor >= 10) return true;
  // `--experimental-detect-module` is enabled by default since Node.js 22.7.0.
  if (major === 22 && minor < 7) return true;
  return false;
};

export const ADDITIONAL_NODE_BUILTINS: (string | RegExp)[] = [
  /^node:/,
  // cspell:word pnpapi
  // Yarn PnP adds pnpapi as "builtin"
  'pnpapi',
];

type BackgroundColor =
  | 'bgBlack'
  | 'bgRed'
  | 'bgGreen'
  | 'bgYellow'
  | 'bgBlue'
  | 'bgMagenta'
  | 'bgCyan'
  | 'bgWhite';

export const bgColor = (background: BackgroundColor, str: string): string => {
  if (['bgRed', 'bgBlack'].includes(background)) {
    return color[background](color.white(color.bold(str)));
  }
  return color[background](color.blackBright(color.bold(str)));
};

/**
 * Check if running in a TTY context
 */
export const isTTY = (type: 'stdin' | 'stdout' = 'stdout'): boolean => {
  return (
    (type === 'stdin' ? process.stdin.isTTY : process.stdout.isTTY) &&
    !process.env.CI
  );
};

export const isDeno: boolean =
  typeof process !== 'undefined' && process.versions?.deno !== undefined;

export const getWorkerSerialization = (): 'advanced' | 'json' => {
  return typeof process !== 'undefined' && process.versions?.bun !== undefined
    ? 'json'
    : 'advanced';
};
