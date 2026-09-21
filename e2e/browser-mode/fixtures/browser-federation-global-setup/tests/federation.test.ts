import { expect, it } from '@rstest/core';
import remoteValue from 'browser-setup-remote/value';

it('loads the remote served by globalSetup', () => {
  expect(remoteValue).toBe('served-by-global-setup');
});

it('does not apply the stage config mutation to the browser project', () => {
  expect(import.meta.env.RSTEST_E2E_PLUGIN_TARGETS).toBe('browser');
});
