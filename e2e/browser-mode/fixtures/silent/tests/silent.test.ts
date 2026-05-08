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

describe('concurrent suite', () => {
  let allowFailingCaseToContinue!: () => void;
  const passingCaseCompleted = new Promise<void>((resolve) => {
    allowFailingCaseToContinue = resolve;
  });

  it.concurrent('concurrent passing case', async () => {
    console.log('BROWSER_CONCURRENT_PASSING_CASE_LOG');
    allowFailingCaseToContinue();
    expect(1 + 1).toBe(2);
  });

  it.concurrent('concurrent intentionally failing case', async () => {
    await passingCaseCompleted;
    console.log('BROWSER_CONCURRENT_FAILING_CASE_LOG');
    expect(1 + 1).toBe(3);
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
