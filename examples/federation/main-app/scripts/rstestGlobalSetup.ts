// Run once in the main process before any tests start.
// This is the stable place to boot a Module Federation node remote server;
// `setupFiles` run per test-entry and can execute concurrently across workers.
import { cleanupNodeRemote, ensureNodeRemote } from './server.setup';

export async function setup() {
  await ensureNodeRemote();
}

export async function teardown() {
  await cleanupNodeRemote();
}
