import type { TestCase, TestSuite } from '../../types';
import { getRealNow } from '../util';

export const TEST_TIMEOUT_BUFFER = 100;

type TestTimeoutContext =
  | Pick<
      TestCase,
      'activeTimeout' | 'activeTimeoutStartTime' | 'startTime' | 'timeout'
    >
  | Pick<TestSuite, 'activeTimeout' | 'activeTimeoutStartTime' | 'timeout'>;

export const getRemainingTestTimeout = (
  test: TestTimeoutContext,
  timeoutBuffer: number,
): number | undefined => {
  const timeout = test.activeTimeout ?? test.timeout;
  const startTime =
    test.activeTimeoutStartTime ??
    ('startTime' in test ? test.startTime : undefined);
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
