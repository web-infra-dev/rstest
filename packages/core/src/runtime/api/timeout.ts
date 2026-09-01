import type { TestCase } from '../../types';
import { getRealNow } from '../util';

export const TEST_TIMEOUT_BUFFER = 100;

export const getRemainingTestTimeout = (
  test: TestCase,
  timeoutBuffer: number,
): number | undefined => {
  if (
    test.startTime === undefined ||
    typeof test.timeout !== 'number' ||
    test.timeout <= 0 ||
    !Number.isFinite(test.timeout)
  ) {
    return undefined;
  }

  const remaining = test.timeout - (getRealNow() - test.startTime);
  const buffer = Math.min(
    timeoutBuffer,
    Math.max(Math.floor(remaining / 2), 0),
  );
  return Math.max(remaining - buffer, 1);
};
