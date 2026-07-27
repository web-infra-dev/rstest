export default async function globalSetup() {
  console.log('[browser-global-setup] executed');

  process.env.RSTEST_E2E_GS = 'from-global-setup';
  // The fixture config sets this key via `test.env`; config must win.
  process.env.RSTEST_E2E_GS_OVERRIDE = 'from-setup';

  return async function globalTeardown() {
    console.log('[browser-global-teardown] executed');
  };
}
