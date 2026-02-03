import { expect, it } from '@rstest/core';

it('should receive FORCE_COLOR=0 when NO_COLOR is set', () => {
  // When NO_COLOR=1 is set, FORCE_COLOR should be '0' to prevent conflicts
  // with libraries that only check FORCE_COLOR
  expect(process.env.FORCE_COLOR).toBe('0');
  expect(process.env.NO_COLOR).toBe('1');
});
