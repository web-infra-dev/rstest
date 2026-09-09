import { cleanupRemote, ensureBrowserRemote } from './server.setup';

export async function setup() {
  await ensureBrowserRemote();
}

export async function teardown() {
  await cleanupRemote();
}
