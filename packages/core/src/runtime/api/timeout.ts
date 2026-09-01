import type { TestCase } from '../../types';
import { getRealNow } from '../util';

export const TEST_TIMEOUT_BUFFER = 100;

export const getRemainingTestTimeout = (
  test: TestCase,
  timeoutBuffer: number,
): number | undefined => {
  const timeout = test.activeTimeout ?? test.timeout;
  const startTime = test.activeTimeoutStartTime ?? test.startTime;
  if (
    startTime === undefined ||
    typeof timeout !== 'number' ||
    timeout <= 0 ||
    !Number.isFinite(timeout)
  ) {
    return undefined;
  }

  const remaining = timeout - (getRealNow() - startTime);
  const buffer = Math.min(
    timeoutBuffer,
    Math.max(Math.floor(remaining / 2), 0),
  );
  return Math.max(remaining - buffer, 1);
};
