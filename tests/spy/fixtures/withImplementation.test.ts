import { describe, expect, it, rstest } from '@rstest/core';

describe('test withImplementation', () => {
  it('withImplementation', () => {
    let isMockCalled = false;
    const mockFn = () => {
      isMockCalled = true;
      console.log('[call original]');
      return 'original';
    };
    const myMockFn = rstest.fn(mockFn);

    const mockFn1 = () => {
      isMockCalled = true;
      console.log('[call original - 1]');
      return 'original - 1';
    };

    myMockFn.mockImplementationOnce(mockFn1);

    myMockFn.withImplementation(
      () => {
        console.log('[call temp]');
        return 'temp';
      },
      () => {
        console.log('[call callback]');
        const res = myMockFn();
        const res1 = myMockFn();
        console.log('[callback res]', res, res1);
      },
    );

    expect(myMockFn.getMockImplementation()).toBe(mockFn1);
    expect(isMockCalled).toBe(false);

    console.log('[call myMockFn]');
    expect(myMockFn()).toBe('original - 1');
    expect(isMockCalled).toBe(true);

    console.log('[call myMockFn - 1]');

    expect(myMockFn()).toBe('original');
    expect(myMockFn).toHaveBeenCalledTimes(4);
  });

  it('withImplementation async', async () => {
    const myMockFn = rstest.fn(() => {
      console.log('[1 - call original]');
      return 'original';
    });

    await myMockFn.withImplementation(
      () => {
        console.log('[1 - call temp]');
        return 'temp';
      },
      async () => {
        console.log('[1 - call callback]');
        const res = myMockFn();
        console.log('[1 - callback res]', res);
      },
    );

    console.log('[1 - call myMockFn]');

    expect(myMockFn()).toBe('original');

    console.log('[1 - call myMockFn - 1]');
    expect(myMockFn()).toBe('original');
  });
});
