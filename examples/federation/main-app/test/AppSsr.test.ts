import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';

test('App SSR renders component-app and node-local sections', async () => {
  const { default: App } = await import('../App.jsx');
  const html = renderToString(React.createElement(App));
  const normalized = html.replace(/<!--.*?-->/g, '');
  expect(normalized).toContain('Buttons:');
  expect(normalized).toContain('Dialog:');
  expect(normalized).toContain('hover me please!');
  expect(normalized).toContain('primary Button');
  expect(normalized).toContain('warning Button');
});
