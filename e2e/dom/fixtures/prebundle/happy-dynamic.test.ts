import { expect, it } from '@rstest/core';

it('loads a transitive happy-dom bridge in an async chunk', async () => {
  // @ts-expect-error The CommonJS compatibility fixture has no declarations.
  const { Window, Document } = await import('./require-happy-dom.cjs');
  const imported = await import('happy-dom');
  expect(imported.Window).toBe(Window);
  expect(imported).not.toHaveProperty('default');
  const win = new Window();
  try {
    win.document.body.innerHTML = '<p>async</p>';
    expect(win.document.querySelector('p').textContent).toBe('async');
    expect(document).toBeInstanceOf(Document);
  } finally {
    win.close();
  }
});
