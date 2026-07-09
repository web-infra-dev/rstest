export default async function globalSetup() {
  console.log('[global-setup-default] executed');

  // Set environment variables to verify execution
  process.env.GLOBAL_SETUP_EXECUTED = 'true';
  process.env.GLOBAL_SETUP_MESSAGE = 'Global setup completed';
  // @ts-expect-error
  global.SETUP = 'true';

  return async function globalTeardown() {
    console.log('[global-teardown-default] executed');
    process.env.GLOBAL_TEARDOWN_EXECUTED = 'true';
  };
}
