import { expect, it } from '@rstest/core';

it('exposes the current test filepath on task context', ({ task }) => {
  expect(task.filepath).toBe(__filename);
});
