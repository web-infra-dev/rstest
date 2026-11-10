import { expect, it } from '@rstest/core';

it('loads a transitive jsdom bridge in an async chunk', async () => {
  // @ts-expect-error The CommonJS compatibility fixture has no declarations.
  const { JSDOM } = await import('./require-jsdom.cjs');
  const dom = new JSDOM('<p>async</p>');
  expect(dom.window.document.querySelector('p').textContent).toBe('async');
  dom.window.close();
});
