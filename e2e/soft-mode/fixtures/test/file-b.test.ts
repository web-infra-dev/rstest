/**
 * @rstest-environment jsdom
 *
 * Runs after file-a in the same worker. Asserts every kind of state
 * soft mode is supposed to reset.
 */
import { describe, expect, it, rstest } from '@rstest/core';

declare global {
  // eslint-disable-next-line no-var
  var __soft_worker_pid__: number | undefined;
  // eslint-disable-next-line no-var
  var __soft_file_seq__: string[] | undefined;
}

globalThis.__soft_file_seq__ ??= [];
globalThis.__soft_file_seq__.push('file-b');

describe('soft mode — file B (state asserter)', () => {
  it('runs in the same worker as file-a', () => {
    expect(globalThis.__soft_worker_pid__).toBe(process.pid);
    // file-a wrote to this array; we appended above. Length >= 2 proves the
    // global state survived (it's a global, not env-reset state).
    expect(globalThis.__soft_file_seq__?.length).toBeGreaterThanOrEqual(2);
  });

  it('starts with a clean DOM body (file-a leaks reset)', () => {
    expect(document.body.innerHTML).toBe('');
    expect(document.querySelector('#from-file-a')).toBeNull();
  });

  it('starts with clean storage', () => {
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem('from-file-a')).toBeNull();
    expect(sessionStorage.getItem('from-file-a-s')).toBeNull();
  });

  it('useFakeTimers() does NOT throw after file-a installed them', () => {
    // file-a installed fake timers and intentionally never uninstalled.
    // Soft mode's between-file teardown should have called useRealTimers()
    // via the captured api. If not, sinon's `install()` throws
    // "Can't install fake timers twice on the same global object".
    expect(() => {
      rstest.useFakeTimers();
      rstest.setSystemTime(new Date('2030-06-15T00:00:00Z'));
    }).not.toThrow();
    expect(new Date().toISOString()).toBe('2030-06-15T00:00:00.000Z');
    rstest.useRealTimers();
  });

  it('HTMLElement.prototype.focus was restored to value-descriptor between files', () => {
    // setup-spy.ts snapshots the descriptor shape on every module
    // re-evaluation BEFORE re-patching. With soft mode working:
    //   file-a setup: sees 'value' (fresh JSDOM)
    //   file-b setup: sees 'value' AGAIN because softReset restored it
    // Without soft mode (or with a broken restore):
    //   file-b setup would see 'get-only' — file-a's patch lingers
    const history = (
      globalThis as { __soft_focus_descriptor_history__?: Array<string> }
    ).__soft_focus_descriptor_history__;
    expect(history).toBeDefined();
    expect(history).toEqual(['value', 'value']);
  });

  it('Element.prototype.getBoundingClientRect spy is fresh', () => {
    // setup-spy.ts re-installed the spy for this file. If file-a's spy
    // wasn't restored, the new spy would wrap the OLD spy and call counts
    // would be inflated. We can't directly inspect the inner chain, but we
    // can check the spy responds to mockClear and starts at zero calls.
    const div = document.createElement('div');
    const before = (
      div.getBoundingClientRect as unknown as {
        mock?: { calls: unknown[] };
      }
    ).mock;
    if (before) {
      // It IS a mock — check it starts with zero recorded calls for this file.
      // (rstest's `clearMocks: true` plus tinyspy.restoreAll between files
      //  yields a fresh spy.)
      expect(before.calls.length).toBe(0);
    }
    div.getBoundingClientRect();
    expect(div.getBoundingClientRect().width).toBe(100);
  });
});
