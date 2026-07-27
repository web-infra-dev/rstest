import isUrl from 'is-url';
import { expect, it, rs } from '@rstest/core';

// No factory: the manual mock under `<rootPath>/__mocks__/is-url.ts` applies.
rs.mock('is-url');

it('manual __mocks__ mock applies in the browser build', () => {
  expect(isUrl('https://example.com')).toBe('is-url manual mock');
});

it('manual mock survives rs.resetModules()', async () => {
  rs.resetModules();
  const reloaded = (await import('is-url')).default;
  expect(reloaded('https://example.com')).toBe('is-url manual mock');
});
