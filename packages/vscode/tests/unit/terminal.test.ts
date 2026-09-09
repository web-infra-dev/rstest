import { describe, expect, it, rs } from '@rstest/core';

// terminal.ts imports `vscode` (used only inside functions), so a stub is enough
// to load the module and exercise the pure `shellQuote`.
rs.mock('vscode', () => ({ default: {} }));

import { shellQuote } from '../../src/terminal';

describe('shellQuote', () => {
  it('leaves safe tokens unquoted', () => {
    expect(shellQuote('run')).toBe('run');
    expect(shellQuote('--coverage')).toBe('--coverage');
    expect(shellQuote('src/foo.test.ts')).toBe('src/foo.test.ts');
  });

  it('single-quotes values with shell-significant characters', () => {
    // A `-t` pattern must not be expanded by the shell.
    expect(shellQuote('^CLI options applies overrides$')).toBe(
      "'^CLI options applies overrides$'",
    );
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote('$HOME')).toBe("'$HOME'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's ok")).toBe("'it'\\''s ok'");
  });

  it('quotes the empty string', () => {
    expect(shellQuote('')).toBe("''");
  });
});
