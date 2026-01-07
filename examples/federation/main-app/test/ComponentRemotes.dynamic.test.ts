import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';

test('dynamic import Button renders SSR', async () => {
  const { default: Button } = await import('component-app/Button');
  const html = renderToString(React.createElement(Button, { type: 'primary' }));
  const normalized = html.replace(/<!--.*?-->/g, '');
  expect(normalized).toContain('primary Button');
});

test('dynamic import Dialog renders SSR when visible', async () => {
  const { default: Dialog } = await import('component-app/Dialog');
  const html = renderToString(
    React.createElement(Dialog, { visible: true, switchVisible: () => {} }),
  );
  expect(html).toContain('What is your name ?');
});

test('dynamic import ToolTip renders SSR with content/message', async () => {
  const { default: ToolTip } = await import('component-app/ToolTip');
  const html = renderToString(
    React.createElement(ToolTip, {
      content: 'hover me please',
      message: 'Hello,world!',
    }),
  );
  expect(html).toContain('hover me please');
  expect(html).toContain('data-content="Hello,world!"');
});
