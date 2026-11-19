import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, it } from '@rstest/core';
import {
  checkFallback,
  failSlowBuild,
  fastStarted,
  slowBuilt,
  slowFailed,
  waitForMarker,
} from './markers';

it('runs the fast project', async () => {
  if (checkFallback) expect(existsSync(slowBuilt)).toBe(true);
  await writeFile(fastStarted, '');
  if (failSlowBuild) await waitForMarker(slowFailed);
});
