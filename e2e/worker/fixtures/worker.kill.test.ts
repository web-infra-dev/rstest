import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { expect, test } from '@rstest/core';

function killWorker() {
  const attempts = process.env.RSTEST_KILL_ATTEMPTS;
  if (!attempts) return;
  appendFileSync(attempts, 'attempt\n');
  const firstAttempt = readFileSync(attempts, 'utf8') === 'attempt\n';
  if (firstAttempt || process.env.RSTEST_ALWAYS_KILL === 'true') {
    // The runtime guards self-targeted process.kill; a child sends the same
    // signal without weakening that guard in production.
    execFileSync('kill', ['-9', String(process.pid)]);
  }
}

test('survives a worker retry', () => {
  killWorker();
  expect(true).toBe(true);
});
