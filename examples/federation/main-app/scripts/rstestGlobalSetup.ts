// Run once in the main process before any tests start.
// This is the stable place to boot a Module Federation node remote server;
// `setupFiles` run per test-entry and can execute concurrently across workers.
export async function setup() {
  const mod = await import('./server.setup');
  await mod.ensureNodeRemote();
}

export async function teardown() {
  const mod = await import('./server.setup');
  await mod.cleanupNodeRemote();
}
