import type { TestError } from '../types';

export const formatTestError = (err: any): TestError[] => {
  const errors = Array.isArray(err) ? err : [err];

  return errors.map((error) => {
    const errObj: TestError = {
      ...error,
      // Some error attributes cannot be enumerated
      message: error.message,
      name: err.name,
      stack: err.stack,
    };
    return errObj;
  });
};
