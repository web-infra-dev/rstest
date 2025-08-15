import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('should render App correctly', async () => {
  render(<App />);

  const element = screen.getByText('Rsbuild with React');

  expect(element.tagName).toBe('H1');

  expect(element.constructor).toBe(document.defaultView?.HTMLHeadingElement);
});

test('should get window property correctly', async () => {
  expect(window.NodeList).toBeDefined();
});

test('should get global property correctly', async () => {
  expect(global.URL).toBeDefined();
});
