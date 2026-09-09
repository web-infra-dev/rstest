// @rstest-environment node

import { expect, it } from '@rstest/core';

it('uses a process-sized call stack', () => {
  let depth = 0;
  const recurse = (): void => {
    depth += 1;
    recurse();
  };

  expect(recurse).toThrow(RangeError);
  expect(depth).toBeLessThan(20_000);
});
