#!/usr/bin/env node
import nodeModule from 'node:module';

// enable on-disk code caching of all modules loaded by Node.js
// requires Nodejs >= 22.8.0
const { enableCompileCache } = nodeModule;
if (enableCompileCache) {
  try {
    enableCompileCache();
  } catch {
    // ignore errors
  }
}

async function main() {
  // Load the CLI router from the `./api` artifact rather than the main entry:
  // `runCLI` is exported from `@rstest/core/api`, never from `@rstest/core`.
  const { runCLI } = await import('../dist/api/index.js');
  await runCLI();
}

main();
