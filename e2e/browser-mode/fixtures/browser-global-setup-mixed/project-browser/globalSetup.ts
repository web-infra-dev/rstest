export default async function globalSetup() {
  console.log('[mixed-browser-global-setup] executed');

  process.env.RSTEST_E2E_GS_BROWSER = 'from-browser-setup';

  return async function globalTeardown() {
    console.log('[mixed-browser-global-teardown] executed');
  };
}
