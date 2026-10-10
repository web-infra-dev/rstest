import { Session } from 'node:inspector/promises';
import { expect, it } from '@rstest/core';

// A test that profiles itself in its own inspector session. Disabling the
// Profiler domain switches V8 coverage to best-effort for the whole isolate.
it('runs its own CPU profile', async () => {
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.start');
  let sum = 0;
  for (let i = 0; i < 1e6; i++) sum += i % 7;
  const { profile } = await session.post('Profiler.stop');
  await session.post('Profiler.disable');
  session.disconnect();

  expect(sum).toBeGreaterThan(0);
  expect(profile.nodes.length).toBeGreaterThan(0);
});
