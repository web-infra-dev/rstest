import { expect, it } from '@rstest/core';
import { normalize } from 'pathe';

it('exposes the current test filepath on task context', ({ task }) => {
  expect(task.filepath).toBeDefined();
  if (task.filepath) {
    expect(normalize(task.filepath)).toBe(normalize(__filename));
  }
});
