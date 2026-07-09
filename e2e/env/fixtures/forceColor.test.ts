import { expect, it } from '@rstest/core';

it('should receive FORCE_COLOR in worker process', () => {
  // When FORCE_COLOR=1 is set by the parent, worker should see it
  expect(process.env.FORCE_COLOR).toBe('1');
});
