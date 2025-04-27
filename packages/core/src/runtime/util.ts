import { format } from 'node:util';
import { diff } from 'jest-diff';
import type { TestError } from '../types';

export const formatTestError = (err: any): TestError[] => {
  const errors = Array.isArray(err) ? err : [err];

  return errors.map((error) => {
    const errObj: TestError = {
      ...error,
      // Some error attributes cannot be enumerated
      message: error.message,
      name: error.name,
      stack: error.stack,
    };

    if (
      error.showDiff ||
      (error.showDiff === undefined &&
        error.expected !== undefined &&
        error.actual !== undefined)
    ) {
      errObj.diff = diff(err.expected, err.actual)!;
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
    return format(templateStr, ...param);
  }

  return templateStr;

  // return template.replace(/%s/g, () => String(param[Object.keys(param)[index]] ?? ''));
};
