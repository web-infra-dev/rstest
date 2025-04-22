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
      errObj.diff = diff(err.actual, err.expected)!;
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
