import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';

test('SSR: Button renders primary', async () => {
  const { default: Button } = await import('../src/Button.jsx');
  const html = renderToString(React.createElement(Button, { type: 'primary' }));
  const normalized = html.replace(/<!--.*?-->/g, '');
  expect(normalized).toContain('primary Button');
});
