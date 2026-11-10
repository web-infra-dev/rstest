import { expect, it, rs } from '@rstest/core';
// @ts-expect-error jsdom types are not installed in this fixture.
import jsdom, { JSDOM, CookieJar } from 'jsdom';
const required = require('./require-jsdom.cjs');

it('shares jsdom between bundled require and import', () => {
  expect(required.JSDOM).toBe(JSDOM);
  expect(jsdom.JSDOM).toBe(JSDOM);
  const jar = new CookieJar();
  const dom = new required.JSDOM('<p>shared</p>', { cookieJar: jar });
  expect(dom.cookieJar).toBe(jar);
  expect(dom.window.document.querySelector('p')?.textContent).toBe('shared');
  dom.window.close();
});

it('can spy on bundled CommonJS exports without changing the environment', () => {
  const original = required.JSDOM;
  const spy = rs.spyOn(required, 'JSDOM').mockImplementation(function (
    html: unknown,
  ) {
    return new original(html);
  });
  try {
    const dom = new required.JSDOM('<p>spy</p>');
    expect(spy).toHaveBeenCalledOnce();
    expect(dom.window.document.querySelector('p')?.textContent).toBe('spy');
    expect(document.createElement('p').tagName).toBe('P');
    dom.window.close();
  } finally {
    spy.mockRestore();
  }
  expect(required.JSDOM).toBe(original);
});
