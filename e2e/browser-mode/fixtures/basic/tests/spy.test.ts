import { describe, expect, it, rstest } from '@rstest/core';

describe('Spy', () => {
  it('restores withImplementation after a synchronous callback throws', () => {
    const spy = rstest.fn(() => 'original');
    spy.mockImplementationOnce(() => 'once');

    expect(() =>
      spy.withImplementation(
        () => 'temporary',
        () => {
          expect(spy()).toBe('temporary');
          throw new Error('sync failure');
        },
      ),
    ).toThrow('sync failure');

    expect(spy()).toBe('once');
    expect(spy()).toBe('original');
  });

  it('restores withImplementation after an asynchronous callback rejects', async () => {
    const spy = rstest.fn(() => 'original');
    spy.mockImplementationOnce(() => 'once');

    await expect(
      spy.withImplementation(
        () => 'temporary',
        async () => {
          expect(spy()).toBe('temporary');
          throw new Error('async failure');
        },
      ),
    ).rejects.toThrow('async failure');

    expect(spy()).toBe('once');
    expect(spy()).toBe('original');
  });

  it('keeps withImplementation active for a cross-realm Promise', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    try {
      const iframeWindow = iframe.contentWindow;
      if (!iframeWindow) {
        throw new Error('Expected the iframe to have a window');
      }

      // lib.dom omits realm globals such as Promise from the Window interface.
      const iframeGlobal = iframeWindow as Window & typeof globalThis;
      const callbackPromise = iframeGlobal.Promise.resolve();
      expect(callbackPromise).not.toBeInstanceOf(Promise);

      const spy = rstest.fn(() => 'original');
      spy.mockImplementationOnce(() => 'once');

      const withImplReturn = spy.withImplementation(
        () => 'temporary',
        () => callbackPromise,
      );

      expect(spy()).toBe('temporary');
      await withImplReturn;
      expect(spy()).toBe('once');
      expect(spy()).toBe('original');
    } finally {
      iframe.remove();
    }
  });
});
