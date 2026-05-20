import { describe, expect, it } from '@rstest/core';

declare global {
  // eslint-disable-next-line no-var
  var __soft_worker_pid__: number | undefined;
}

describe('soft mode happy-dom — file B', () => {
  it('runs in the same worker as file A', () => {
    expect(globalThis.__soft_worker_pid__).toBe(process.pid);
  });

  it('starts with a clean DOM body', () => {
    expect(document.body.innerHTML).toBe('');
    expect(document.querySelector('#from-a')).toBeNull();
  });

  it('starts with clean storage', () => {
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem('from-a')).toBeNull();
  });

  it('HTMLElement.prototype.focus descriptor restored across files', () => {
    // setup.ts records the descriptor SHAPE on each module re-eval BEFORE
    // re-patching. With softMode handling happy-dom, file-a saw 'value'
    // (fresh DOM) and file-b also saw 'value' because softResetEnv's
    // protoSnapshot restore wiped file-a's getter-only patch.
    const history = (
      globalThis as { __soft_focus_descriptor_history__?: Array<string> }
    ).__soft_focus_descriptor_history__;
    expect(history).toEqual(['value', 'value']);
  });
});
