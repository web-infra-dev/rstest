import { isAbsolute, join, parse, sep } from 'pathe';
import color from 'picocolors';
import type { RuntimeConfig, TestResult } from '../types';
import { TEST_DELIMITER } from './constants';

export function getAbsolutePath(base: string, filepath: string): string {
  return isAbsolute(filepath) ? filepath : join(base, filepath);
}

export const parsePosix = (filePath: string): { dir: string; base: string } => {
  const { dir, base } = parse(filePath);

  return {
    dir: dir.split(sep).join('/'),
    base,
  };
};

export function slash(path: string): string {
  return path.replace(/\\/g, '/');
}

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

  const minutes = Math.floor(seconds / 60);
  const secondsRemainder = seconds % 60;
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
): string => getTaskNames(test).join(` ${delimiter} `);

const REGEXP_FLAG_PREFIX = 'RSTEST_REGEXP:';

const wrapRegex = (value: RegExp): string =>
  `${REGEXP_FLAG_PREFIX}${value.toString()}`;

const unwrapRegex = (value: string): RegExp | string => {
  if (value.startsWith(REGEXP_FLAG_PREFIX)) {
    const regexStr = value.slice(REGEXP_FLAG_PREFIX.length);

    const matches = regexStr.match(/^\/(.+)\/([gimuy]*)$/);
    if (matches) {
      const [, pattern, flags] = matches;
      return new RegExp(pattern!, flags);
    }
  }
  return value;
};

/**
 * Makes some special types that are not supported for passing into the pool serializable.
 * eg. RegExp
 */
export const serializableConfig = (
  normalizedConfig: RuntimeConfig,
): RuntimeConfig => {
  const { testNamePattern } = normalizedConfig;
  return {
    ...normalizedConfig,
    testNamePattern:
      testNamePattern && typeof testNamePattern !== 'string'
        ? wrapRegex(testNamePattern)
        : testNamePattern,
  };
};

export const undoSerializableConfig = (
  normalizedConfig: RuntimeConfig,
): RuntimeConfig => {
  const { testNamePattern } = normalizedConfig;
  return {
    ...normalizedConfig,
    testNamePattern:
      testNamePattern && typeof testNamePattern === 'string'
        ? unwrapRegex(testNamePattern)
        : testNamePattern,
  };
};

export const getNodeVersion = (): {
  major: number;
  minor: number;
  patch: number;
} => {
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

// Ported from https://github.com/webpack/webpack/blob/21b28a82f7a6ec677752e1c8fb722a830a2adf69/lib/node/NodeTargetPlugin.js.
export const NODE_BUILTINS: (string | RegExp)[] = [
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  /^node:/,

  // cspell:word pnpapi
  // Yarn PnP adds pnpapi as "builtin"
  'pnpapi',
];

export { color };
