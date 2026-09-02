import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { rstackEditorTakesOver } from '../../src/migrationNotice';

let installed = new Set<string>();
const settings: Record<string, unknown> = {};

rs.mock('vscode', () => ({
  default: {
    MarkdownString: class {},
    extensions: {
      getExtension: (id: string) => (installed.has(id) ? { id } : undefined),
    },
    workspace: {
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
    for (const key of Object.keys(settings)) {
      delete settings[key];
    }
  });

  it('keeps this extension active without Rstack Editor', () => {
    expect(rstackEditorTakesOver()).toBe(false);
  });

  it('stands down when Rstack Editor is enabled', () => {
    installed = new Set(['rstack.rstack']);
    expect(rstackEditorTakesOver()).toBe(true);
  });

  it('stays active when Rstack Editor has its Rstest stack switched off', () => {
    installed = new Set(['rstack.rstack']);
    settings['rstack.rstest.enable'] = false;
    expect(rstackEditorTakesOver()).toBe(false);
  });
});
