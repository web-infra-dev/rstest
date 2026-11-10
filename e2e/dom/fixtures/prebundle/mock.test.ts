import { expect, it, rs } from '@rstest/core';
// @ts-expect-error jsdom types are not installed in this fixture.
import { JSDOM } from 'jsdom';

rs.mock('jsdom', () => ({
  JSDOM: class {
    marker = 'mocked';
  },
}));

it('can mock the shared module without mocking the test environment', () => {
  expect(new JSDOM().marker).toBe('mocked');
  expect(document.createElement('p').tagName).toBe('P');
});
