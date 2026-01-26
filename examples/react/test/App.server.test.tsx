import { expect, test } from '@rstest/core';
import { renderToString } from '../src/App.server';

test('renders correctly on server with default greeting', () => {
  const html = renderToString();
  expect(html).toContain('Hello World');
  expect(html).toContain('Start building amazing things with React.');
});

test('renders correctly on server with custom greeting', () => {
  const html = renderToString({ greeting: 'Welcome' });
  expect(html).toContain('Welcome');
  expect(html).not.toContain('Hello World');
});

test('renders valid HTML structure', () => {
  const html = renderToString();
  expect(html).toContain('<div');
  expect(html).toContain('<h1>');
  expect(html).toContain('<p>');
});
