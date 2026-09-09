import { expect, it } from '@rstest/core';

declare global {
  var __RSTEST_MAPPED_FAILURE__: (() => never) | undefined;
  var __RSTEST_QUERY_MAPPED_FAILURE__: (() => never) | undefined;
}

it('reports a stack mapped through an external source map', async () => {
  const script = document.createElement('script');
  script.src = new URL('/mapped-error.js', location.href).href;
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error(`Failed to load ${script.src}`)),
    );
  });
  document.head.append(script);

  try {
    await loaded;
    const throwMappedError = globalThis.__RSTEST_MAPPED_FAILURE__;
    expect(throwMappedError).toBeTypeOf('function');
    if (!throwMappedError) {
      throw new Error('Expected the mapped failure function');
    }
    throwMappedError();
  } finally {
    script.remove();
    Reflect.deleteProperty(globalThis, '__RSTEST_MAPPED_FAILURE__');
  }
});

it('reports a stack mapped through a hidden map for a query script', async () => {
  const script = document.createElement('script');
  script.src = new URL('/query-mapped-error.js?version=1', location.href).href;
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error(`Failed to load ${script.src}`)),
    );
  });
  document.head.append(script);

  try {
    await loaded;
    const throwMappedError = globalThis.__RSTEST_QUERY_MAPPED_FAILURE__;
    expect(throwMappedError).toBeTypeOf('function');
    if (!throwMappedError) {
      throw new Error('Expected the query-mapped failure function');
    }
    throwMappedError();
  } finally {
    script.remove();
    Reflect.deleteProperty(globalThis, '__RSTEST_QUERY_MAPPED_FAILURE__');
  }
});
