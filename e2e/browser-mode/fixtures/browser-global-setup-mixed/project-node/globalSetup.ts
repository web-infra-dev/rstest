export default async function globalSetup() {
  console.log('[mixed-node-global-setup] executed');

  process.env.RSTEST_E2E_GS_NODE = 'from-node-setup';

  return async function globalTeardown() {
    console.log('[mixed-node-global-teardown] executed');
  };
}
