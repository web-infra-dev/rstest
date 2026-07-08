import { afterAll, describe, expect, it, rstest } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs).toEqual([
    '[call callback]',
    '[call temp]',
    '[call temp]',
    '[callback res] temp temp',
    '[call myMockFn]',
    '[call original - 1]',
    '[call myMockFn - 1]',
    '[call original]',
    '[1 - call callback]',
    '[1 - call temp]',
    '[1 - callback res] temp',
    '[1 - call myMockFn]',
    '[1 - call original]',
    '[1 - call myMockFn - 1]',
    '[1 - call original]',
  ]);
});

describe('test withImplementation', () => {
  it('withImplementation', () => {
    let isMockCalled = false;
    const mockFn = () => {
      isMockCalled = true;
      logs.push('[call original]');
      return 'original';
    };
    const myMockFn = rstest.fn(mockFn);

    const mockFn1 = () => {
      isMockCalled = true;
      logs.push('[call original - 1]');
      return 'original - 1';
    };

    myMockFn.mockImplementationOnce(mockFn1);

    const withImplReturn = myMockFn.withImplementation(
      () => {
        logs.push('[call temp]');
        return 'temp';
      },
      () => {
        logs.push('[call callback]');
        const res = myMockFn();
        const res1 = myMockFn();
        logs.push(`[callback res] ${res} ${res1}`);
      },
    );

    // A sync callback returns the mock instance, so it can be chained.
    expect(withImplReturn).toBe(myMockFn);
    expect(myMockFn.getMockImplementation()).toBe(mockFn1);
    expect(isMockCalled).toBe(false);

    logs.push('[call myMockFn]');
    expect(myMockFn()).toBe('original - 1');
    expect(isMockCalled).toBe(true);

    logs.push('[call myMockFn - 1]');

    expect(myMockFn()).toBe('original');
    expect(myMockFn).toHaveBeenCalledTimes(4);
  });

  it('withImplementation async', async () => {
    const myMockFn = rstest.fn(() => {
      logs.push('[1 - call original]');
      return 'original';
    });

    // An async callback resolves to the mock instance.
    const withImplReturn = await myMockFn.withImplementation(
      () => {
        logs.push('[1 - call temp]');
        return 'temp';
      },
      async () => {
        logs.push('[1 - call callback]');
        const res = myMockFn();
        logs.push(`[1 - callback res] ${res}`);
      },
    );

    expect(withImplReturn).toBe(myMockFn);

    logs.push('[1 - call myMockFn]');

    expect(myMockFn()).toBe('original');

    logs.push('[1 - call myMockFn - 1]');
    expect(myMockFn()).toBe('original');
  });
});
