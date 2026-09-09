import { expect, it } from '@rstest/core';

it('loads a mapped project source from another origin', async () => {
  const scriptUrl = new URL('/cross-origin.js', location.href);
  scriptUrl.hostname = 'localhost.';
  expect(scriptUrl.origin).not.toBe(location.origin);

  const script = document.createElement('script');
  script.src = scriptUrl.href;
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error(`Failed to load ${scriptUrl.href}`)),
    );
  });
  document.head.append(script);

  try {
    await loaded;
    expect(Reflect.get(globalThis, '__RSTEST_CROSS_ORIGIN_COVERAGE__')).toBe(
      42,
    );
  } finally {
    script.remove();
    Reflect.deleteProperty(globalThis, '__RSTEST_CROSS_ORIGIN_COVERAGE__');
  }
});
