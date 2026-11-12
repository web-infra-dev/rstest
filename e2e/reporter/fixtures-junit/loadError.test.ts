import { expect, it } from '@rstest/core';

class LoadError extends Error {
  override name = 'Load&Error';
}

// Thrown from a function so that the test below is not unreachable code.
function failToLoad(): void {
  throw new LoadError('failed <while> loading');
}

failToLoad();

it('never runs', () => {
  expect(1 + 1).toBe(2);
});
