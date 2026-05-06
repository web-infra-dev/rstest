import { beforeAll, describe, expect, it } from '@rstest/core';

console.log('BROWSER_FILE_LEVEL_LOG');

describe('passing suite', () => {
  beforeAll(() => {
    console.log('BROWSER_PASSING_SUITE_LOG');
  });

  it('passing case', () => {
    console.log('BROWSER_PASSING_CASE_LOG');
    expect(1 + 1).toBe(2);
  });
});

describe('failing suite', () => {
  beforeAll(() => {
    console.log('BROWSER_FAILING_SUITE_LOG');
  });

  it('failing case', () => {
    console.log('BROWSER_FAILING_CASE_LOG');
    expect(1 + 1).toBe(3);
  });
});
