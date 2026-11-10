import { expect, it, rs } from '@rstest/core';
import { Window, Document, GlobalWindow } from 'happy-dom';
const required = require('./require-happy-dom.cjs');

it('shares happy-dom between require, import and the environment', () => {
  expect(required.Window).toBe(Window);
  expect(required.GlobalWindow).toBe(GlobalWindow);
  expect(document).toBeInstanceOf(Document);
  expect(required).not.toHaveProperty('default');
  const win = new required.Window();
  try {
    win.document.body.innerHTML = '<p>shared</p>';
    expect(win.document.querySelector('p')?.textContent).toBe('shared');
    expect(win.document).toBeInstanceOf(Document);
  } finally {
    win.close();
  }
});

it('can spy on CommonJS exports without changing the environment', () => {
  const original = required.Window;
  const spy = rs.spyOn(required, 'Window').mockImplementation(function () {
    return new original();
  });
  try {
    const win = new required.Window();
    expect(spy).toHaveBeenCalledOnce();
    expect(document.createElement('p').tagName).toBe('P');
    win.close();
  } finally {
    spy.mockRestore();
  }
  expect(required.Window).toBe(original);
});
