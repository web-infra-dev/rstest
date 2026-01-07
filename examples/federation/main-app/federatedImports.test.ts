import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';

test('SSR renders App with federated components', async () => {
  const { default: App } = await import('./App.jsx');
  const html = renderToString(React.createElement(App));

  expect(html).toContain('Buttons:');
  expect(html).toContain('Dialog:');
  expect(html).toContain('hover me please!');
  const normalized = html.replace(/<!--.*?-->/g, '');
  expect(normalized).toContain('primary Button');
  expect(normalized).toContain('warning Button');
  expect(html).toContain('data-content="Hello,world!"');
});

test('SSR renders Dialog remote when visible', async () => {
  const { default: Dialog } = await import('component-app/Dialog');
  const html = renderToString(React.createElement(Dialog, { visible: true, switchVisible: () => {} }));
  expect(html).toContain('What is your name ?');
  expect(html).toContain('close It!');
});

test('SSR renders ToolTip remote with content and message', async () => {
  const { default: ToolTip } = await import('component-app/ToolTip');
  const html = renderToString(React.createElement(ToolTip, { content: 'hover me please', message: 'Hello,world!' }));
  expect(html).toContain('hover me please');
  expect(html).toContain('data-content="Hello,world!"');
});
