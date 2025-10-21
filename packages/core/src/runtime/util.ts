import { createRequire } from 'node:module';
import { format } from 'node:util';
import { diff } from 'jest-diff';
import type { FormattedError, Test } from '../types';

const REAL_TIMERS: {
  setTimeout?: typeof globalThis.setTimeout;
} = {};

// store the original timers
export const setRealTimers = (): void => {
  REAL_TIMERS.setTimeout ??= globalThis.setTimeout;
};

export const getRealTimers = (): typeof REAL_TIMERS => {
  return REAL_TIMERS;
};

export const formatTestError = (err: any, test?: Test): FormattedError[] => {
  const errors = Array.isArray(err) ? err : [err];

  return errors.map((rawError) => {
    const error =
      typeof rawError === 'string' ? { message: rawError } : rawError;
    const errObj: FormattedError = {
      ...error,
      // Some error attributes cannot be enumerated
      message: error.message,
      name: error.name,
      stack: error.stack,
    };

    if (error instanceof TestRegisterError && test?.type === 'case') {
      errObj.message = `Can't nest describe or test inside a test. ${error.message} because it is nested within test '${test.name}'`;
    }

    if (
      error.showDiff ||
      (error.showDiff === undefined &&
        error.expected !== undefined &&
        error.actual !== undefined)
    ) {
      errObj.diff = diff(err.expected, err.actual, {
        expand: false,
      })!;
    }

    for (const key of ['actual', 'expected'] as const) {
      if (typeof err[key] !== 'string') {
        (errObj as Record<string, any>)[key] = JSON.stringify(
          err[key],
          null,
          10,
        );
      }
    }

    return errObj;
  });
};
// cspell:ignore sdjifo
const formatRegExp = /%[sdjifoOc%]/;

export const formatName = (
  template: string,
  param: any[] | Record<string, any>,
  index: number,
): string => {
  let templateStr = template;

  if (['%%', '%#', '%$'].some((flag) => templateStr.includes(flag))) {
    // '%%' single percent sign ('%')
    // '%#' match index (0 based) of the test case
    // '%$' match index (1 based) of the test case
    templateStr = templateStr
      .replace(/%%/g, '__rstest_escaped_%__')
      .replace(/%#/g, `${index}`)
      .replace(/%\$/g, `${index + 1}`)
      .replace(/__rstest_escaped_%__/g, '%%');
  }

  if (Array.isArray(param)) {
    // format printf-like string
    // https://nodejs.org/api/util.html#util_util_format_format_args
    return formatRegExp.test(templateStr)
      ? format(templateStr, ...param)
      : templateStr;
  }

  if (formatRegExp.test(templateStr)) {
    templateStr = format(templateStr, param);
  }

  return templateStr.replace(/\$([$\w.]+)/g, (_, key: string) => {
    const value = getValue(param, key);
    return value?.toString();
  });
};

function getValue(source: any, path: string, defaultValue = undefined): any {
  // a[3].b -> a.3.b
  const paths = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let result = source;
  for (const p of paths) {
    result = result[p];
    if (result === undefined) {
      return defaultValue;
    }
  }
  return result;
}

export class TestRegisterError extends Error {}

export class RstestError extends Error {
  public fullStack?: boolean;
}

export function checkPkgInstalled(name: string): void {
  const require = createRequire(import.meta.url);
  try {
    require.resolve(name);
  } catch (error: any) {
    if (error.code === 'MODULE_NOT_FOUND') {
      const error = new RstestError(
        `Missing dependency "${name}". Please install it first.`,
      );
      error.fullStack = true;
      throw error;
    }
    throw error;
  }
}
