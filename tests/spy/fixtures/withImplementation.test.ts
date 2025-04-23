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

    myMockFn.withImplementation(
      () => {
        console.log('[call temp]');
        return 'temp';
      },
      () => {
        console.log('[call callback]');
        const res = myMockFn();
        console.log('[callback res]', res);
      },
    );

    expect(myMockFn.getMockImplementation()).toBe(mockFn);
    expect(isMockCalled).toBe(false);

    console.log('[call myMockFn]');
    expect(myMockFn()).toBe('original');
    expect(isMockCalled).toBe(true);

    console.log('[call myMockFn - 1]');

    expect(myMockFn()).toBe('original');
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
