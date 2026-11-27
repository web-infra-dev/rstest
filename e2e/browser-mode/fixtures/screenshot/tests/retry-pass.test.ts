import { expect, it } from '@rstest/core';

it('passes after two failed attempts', ({ task }) => {
  document.body.textContent = `Attempt ${task.retryCount + 1}`;
  expect(task.retryCount).toBe(2);
});
