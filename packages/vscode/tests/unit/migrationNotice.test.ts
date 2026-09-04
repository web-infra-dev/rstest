import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { rstackEditorTakesOver } from '../../src/migrationNotice';

let installed = new Set<string>();
let isTrusted = true;
const settings: Record<string, unknown> = {};

rs.mock('vscode', () => ({
  default: {
    MarkdownString: class {},
    extensions: {
      getExtension: (id: string) => (installed.has(id) ? { id } : undefined),
    },
    workspace: {
      get isTrusted() {
        return isTrusted;
      },
      getConfiguration: (section: string) => ({
        get: (key: string, fallback: unknown) =>
          settings[`${section}.${key}`] ?? fallback,
      }),
    },
    window: { createOutputChannel: () => ({}) },
  },
}));

describe('rstackEditorTakesOver', () => {
  afterEach(() => {
    installed = new Set();
    isTrusted = true;
    for (const key of Object.keys(settings)) {
      delete settings[key];
    }
  });

  it('keeps this extension active without the Rstack extension', () => {
    expect(rstackEditorTakesOver()).toBe(false);
  });

  it('stands down when the setting is default and the workspace is trusted', () => {
    installed = new Set(['rstack.rstack']);
    expect(rstackEditorTakesOver()).toBe(true);
  });

  it('stays active when the workspace is untrusted', () => {
    installed = new Set(['rstack.rstack']);
    isTrusted = false;
    expect(rstackEditorTakesOver()).toBe(false);
  });

  it('stays active when the Rstack extension has its Rstest stack switched off', () => {
    installed = new Set(['rstack.rstack']);
    settings['rstack.rstest.enable'] = false;
    expect(rstackEditorTakesOver()).toBe(false);
  });
});
