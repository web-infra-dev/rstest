import { describe, expect, it } from '@rstest/core';

declare global {
  // eslint-disable-next-line no-var
  var __soft_worker_pid__: number | undefined;
}

globalThis.__soft_worker_pid__ ??= process.pid;

describe('soft mode happy-dom — file A', () => {
  it('owns a fresh DOM body', () => {
    expect(document.body.innerHTML).toBe('');
    document.body.innerHTML = '<div id="from-a">x</div>';
  });

  it('mutates storage', () => {
    expect(localStorage.length).toBe(0);
    localStorage.setItem('from-a', 'leaked-if-soft-reset-broken');
  });
});
