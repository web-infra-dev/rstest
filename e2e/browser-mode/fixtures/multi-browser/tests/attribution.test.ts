import { expect, test } from '@rstest/core';

test('passes in every configured browser', () => {
  expect(document.createElement('main').tagName).toBe('MAIN');
});

test('reports per browser', () => {
  expect(1 + 1).toBe(2);
});

const isFirefox = navigator.userAgent.includes('Firefox');
const {
  innerWidth,
  navigator: { language },
} = window;

test.runIf(!isFirefox)(
  `Chromium at ${innerWidth}px with locale ${language}`,
  () => {
    expect([innerWidth, language]).toEqual([820, 'en-GB']);
  },
);

test.runIf(isFirefox)(
  `Firefox at ${innerWidth}px with locale ${language}`,
  () => {
    expect([innerWidth, language]).toEqual([900, 'fr-FR']);
  },
);
