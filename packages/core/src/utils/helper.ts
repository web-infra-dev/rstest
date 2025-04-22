import { isAbsolute, join, parse, sep } from 'pathe';
import color from 'picocolors';
import type { NormalizedConfig, TestResult } from '../types';
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
  const format = (time: string) => color.bold(time);

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }

  const seconds = milliseconds / 1000;

  if (seconds < 10) {
    const digits = seconds >= 0.01 ? 2 : 3;
    return `${format(seconds.toFixed(digits))} s`;
  }

  if (seconds < 60) {
    return `${format(seconds.toFixed(1))} s`;
  }

  const minutes = seconds / 60;
  return `${format(minutes.toFixed(2))} m`;
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
  normalizedConfig: NormalizedConfig,
): NormalizedConfig => {
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
  normalizedConfig: NormalizedConfig,
): NormalizedConfig => {
  const { testNamePattern } = normalizedConfig;
  return {
    ...normalizedConfig,
    testNamePattern:
      testNamePattern && typeof testNamePattern === 'string'
        ? unwrapRegex(testNamePattern)
        : testNamePattern,
  };
};

export { color };
