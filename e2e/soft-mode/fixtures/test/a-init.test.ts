/**
 * @rstest-environment jsdom
 *
 * First file in a soft-mode worker. Establishes state (mutates DOM, sets
 * storage, installs fake timers, exercises the focus patch). The next
 * files assert all of this is reset between them.
 */
import { describe, expect, it, rstest } from '@rstest/core';

declare global {
  // eslint-disable-next-line no-var
  var __soft_worker_pid__: number | undefined;
  // eslint-disable-next-line no-var
  var __soft_file_seq__: string[] | undefined;
}

// Capture the worker's pid; later files assert the same pid (worker reuse).
globalThis.__soft_worker_pid__ ??= process.pid;
globalThis.__soft_file_seq__ ??= [];
globalThis.__soft_file_seq__.push('file-a');

describe('soft mode — file A (state setter)', () => {
  it('owns a fresh DOM body', () => {
    expect(document.body.innerHTML).toBe('');
    document.body.innerHTML = '<div id="from-file-a">x</div>';
    expect(document.querySelector('#from-file-a')).not.toBeNull();
  });

  it('owns fresh storage', () => {
    expect(localStorage.length).toBe(0);
    localStorage.setItem('from-file-a', 'leaked-if-soft-reset-broken');
    sessionStorage.setItem('from-file-a-s', 'leaked-if-soft-reset-broken');
  });

  it('installs fake timers without throwing', () => {
    rstest.useFakeTimers();
    rstest.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    expect(new Date().toISOString()).toBe('2020-01-01T00:00:00.000Z');
    // Deliberately DO NOT call useRealTimers() — soft mode must restore
    // real timers between files, otherwise a downstream file's
    // useFakeTimers() throws "Can't install fake timers twice on the
    // same global object".
  });

  it('exercises HTMLElement.prototype.focus patch', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    el.focus();
    expect(
      (globalThis as { __soft_focus_calls__?: number }).__soft_focus_calls__,
    ).toBeGreaterThan(0);
  });
});
