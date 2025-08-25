import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('should render App correctly', async () => {
  render(<App />);

  const element = screen.getByText('Rsbuild with React');

  expect(element.tagName).toBe('H1');

  expect(element.constructor).toBe(document.defaultView?.HTMLHeadingElement);
});

test('should get document correctly', () => {
  expect(global.document).toBeDefined();
});

it('should load root setup file correctly', () => {
  expect(process.env.TEST_ROOT).toBe('1');
});
