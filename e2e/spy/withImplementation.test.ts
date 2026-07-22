import { runInNewContext } from 'node:vm';
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

  it('withImplementation maybe async', async () => {
    const myMockFn = rstest.fn(() => 'original');
    const callback = (): void | Promise<void> => Promise.resolve();

    const withImplReturn = myMockFn.withImplementation(() => 'temp', callback);
    // The inferred union must retain its Promise branch for maybe-async helpers.
    const promiseReturn: Extract<
      typeof withImplReturn,
      Promise<unknown>
    > = Promise.resolve(myMockFn);

    expect(await promiseReturn).toBe(myMockFn);
    expect(await withImplReturn).toBe(myMockFn);
  });

  it('restores the implementation after a synchronous callback throws', () => {
    const myMockFn = rstest.fn(() => 'original');
    myMockFn.mockImplementationOnce(() => 'once');

    expect(() =>
      myMockFn.withImplementation(
        () => 'temporary',
        () => {
          expect(myMockFn()).toBe('temporary');
          throw new Error('sync failure');
        },
      ),
    ).toThrow('sync failure');

    expect(myMockFn()).toBe('once');
    expect(myMockFn()).toBe('original');
  });

  it('restores the implementation after an asynchronous callback rejects', async () => {
    const myMockFn = rstest.fn(() => 'original');
    myMockFn.mockImplementationOnce(() => 'once');

    await expect(
      myMockFn.withImplementation(
        () => 'temporary',
        async () => {
          expect(myMockFn()).toBe('temporary');
          throw new Error('async failure');
        },
      ),
    ).rejects.toThrow('async failure');

    expect(myMockFn()).toBe('once');
    expect(myMockFn()).toBe('original');
  });

  it('keeps the temporary implementation until a cross-realm Promise resolves', async () => {
    const callbackPromise: Promise<void> = runInNewContext('Promise.resolve()');
    expect(callbackPromise).not.toBeInstanceOf(Promise);

    const myMockFn = rstest.fn(() => 'original');
    myMockFn.mockImplementationOnce(() => 'once');

    const withImplReturn = myMockFn.withImplementation(
      () => 'temporary',
      () => callbackPromise,
    );

    expect(myMockFn()).toBe('temporary');
    await withImplReturn;
    expect(myMockFn()).toBe('once');
    expect(myMockFn()).toBe('original');
  });
});
