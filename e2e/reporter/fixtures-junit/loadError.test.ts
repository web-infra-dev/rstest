import { expect, it } from '@rstest/core';

class LoadError extends Error {
  override name = 'Load&Error';
}

throw new LoadError('failed <while> loading');

it('never runs', () => {
  expect(1 + 1).toBe(2);
});
