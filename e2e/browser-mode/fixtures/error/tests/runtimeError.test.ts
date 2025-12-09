import { describe, it } from '@rstest/core';

describe('runtime error', () => {
  it('should throw runtime error', () => {
    // This will throw a runtime error
    const obj: Record<string, unknown> = {};
    // @ts-expect-error intentional error
    obj.nonExistent.property;
  });
});
