import { expect, test } from '@rstest/core';

test('should expose object URLs to scripts in the jsdom realm', () => {
  const script = document.createElement('script');
  script.textContent = `
    document.documentElement.dataset.objectUrl = URL.createObjectURL(
      new Blob(['script blob'], { type: 'text/plain' }),
    );
    document.documentElement.dataset.urlSearchParamsRealm = String(
      new URL('https://example.test/?key=value').searchParams
        instanceof URLSearchParams,
    );
  `;
  document.head.appendChild(script);

  const url = document.documentElement.dataset.objectUrl!;
  expect(url).toMatch(/^blob:nodedata:/);
  expect(document.documentElement.dataset.urlSearchParamsRealm).toBe('true');
  URL.revokeObjectURL(url);
});
