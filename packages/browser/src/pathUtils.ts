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

/**
 * In-memory identity of one (`project`, `browser`, `testPath`) row, shared by
 * every process-lifetime map inside the host: tracker keys, screenshot file
 * keys, per-row scheduler maps. Process-local and free to change; the persisted
 * blobs (`blobFileKey`) and on-disk screenshot hash each keep their own
 * versioned grammars.
 */
import type { BrowserName } from './protocol';

export const browserRowKey = (
  project: string,
  testPath: string,
  browserName?: BrowserName,
): string => `${project}\u0000${browserName ?? ''}\u0000${testPath}`;
