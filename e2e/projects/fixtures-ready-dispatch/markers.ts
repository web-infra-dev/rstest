import { existsSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

export const fastStarted = process.env.RSTEST_FAST_PROJECT_MARKER!;
export const fastBuilt = fastStarted + '.fast-built';
export const slowBuilt = fastStarted + '.slow-built';
export const slowFailed = fastStarted + '.slow-failed';
export const checkFallback = process.env.RSTEST_CHECK_DISPATCH_FALLBACK === '1';
export const failSlowBuild = process.env.RSTEST_FAIL_SLOW_PROJECT === '1';

export async function waitForMarker(marker: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!existsSync(marker)) {
    if (Date.now() >= deadline) {
      throw new Error(`Missing scheduling marker ${marker}`);
    }
    await setTimeout(20);
  }
}
