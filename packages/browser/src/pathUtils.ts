import { normalize } from 'pathe';

/**
 * Normalize a test path for equality checks while preserving its display form.
 * Windows paths are case-insensitive even when these helpers are exercised on
 * a case-sensitive host during tests.
 */
export const getTestPathKey = (testPath: string): string => {
  const normalized = normalize(testPath);
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
};
