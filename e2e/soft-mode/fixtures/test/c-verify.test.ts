/**
 * @rstest-environment jsdom
 *
 * Runs after `a-init` and `b-leak` in the same worker. Asserts every
 * kind of state soft mode is supposed to reset.
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
  it('runs in the same worker as a-init and b-leak', () => {
    expect(globalThis.__soft_worker_pid__).toBe(process.pid);
    // Each file pushed its tag; exact sequence pins file ordering AND
    // proves the global survived softReset (which only clears env-side
    // state, not arbitrary globals). `file-leaker` being present here
    // also proves the leaker file completed successfully — its deferred
    // unhandled rejection + throw were absorbed by
    // `drainPendingAsyncFromPriorFile` before this file's `preparePool`
    // installed per-file handlers. If the absorber regresses, those
    // leaks would bubble into this file's slot and fail the suite.
    expect(globalThis.__soft_file_seq__).toEqual([
      'file-a',
      'file-leaker',
      'file-b',
    ]);
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
    // re-evaluation BEFORE re-patching. With soft mode working, every
    // file's setupFile sees a freshly-restored `value` descriptor (the
    // prior file's getter-only patch was wiped by softResetEnv's
    // protoSnapshot restore). Without soft mode, file 2+ would see
    // `'get-only'` — the prior file's patch lingers.
    //
    // 3 files in this fixture (a-init, b-leak, c-verify) → 3 captures,
    // all should be `'value'`.
    const history = (
      globalThis as { __soft_focus_descriptor_history__?: Array<string> }
    ).__soft_focus_descriptor_history__;
    expect(history).toBeDefined();
    expect(history).toEqual(['value', 'value', 'value']);
  });

  it('Element.prototype.getBoundingClientRect spy is fresh', () => {
    // setup-spy.ts re-installed the spy for this file. If file-a's spy
    // wasn't restored across the file boundary, the new spy would wrap
    // the OLD spy and `.mock.calls` would already be non-empty.
    const div = document.createElement('div');
    const mock = (
      div.getBoundingClientRect as unknown as {
        mock?: { calls: unknown[] };
      }
    ).mock;
    // Assert it IS a mock — proves setup-spy.ts re-ran for file-b.
    // Without this assertion the spy-restored check would silently pass
    // when the spy didn't install at all (regression in setupFile re-eval).
    expect(mock).toBeDefined();
    expect(mock!.calls.length).toBe(0);
    div.getBoundingClientRect();
    expect(div.getBoundingClientRect().width).toBe(100);
  });
});
