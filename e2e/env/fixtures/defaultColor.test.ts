import { expect, it } from '@rstest/core';

it('should not force color env in non-TTY when no color env is set by user', () => {
  // When the rstest process itself has no color support (e.g., piped stdout
  // in e2e tests), and neither FORCE_COLOR nor NO_COLOR is set by the user,
  // rstest should not inject color env vars into workers.
  // Note: In a real TTY terminal, isColorSupported=true and rstest WILL
  // inject FORCE_COLOR=1 so workers produce colored diff output.
  expect(process.env.FORCE_COLOR).toBeUndefined();
  expect(process.env.NO_COLOR).toBeUndefined();
});
