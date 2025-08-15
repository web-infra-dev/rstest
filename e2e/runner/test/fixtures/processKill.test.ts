import { expect, it } from '@rstest/core';

it('process.kill', async () => {
  process.kill(process.pid, 'SIGTERM');
  expect(1 + 1).toBe(2);
});
