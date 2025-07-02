import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('should render App correctly', async () => {
  render(<App />);

  const element = screen.getByText('Rsbuild with React');

  expect(element.tagName).toBe('H1');

  expect(element.style.fontSize).toBe('16px');

  const elementP = screen.getByText(
    'Start building amazing things with Rsbuild.',
  );

  expect(elementP.tagName).toBe('P');

  expect(elementP.className).toBe('App-module_content-p');

  expect(elementP.style.fontSize).toBe('');
});
