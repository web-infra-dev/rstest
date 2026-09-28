#!/usr/bin/env node
import nodeModule from 'node:module';

// enable on-disk code caching for the CLI process
// requires Nodejs >= 22.8.0
const { enableCompileCache } = nodeModule;
const isCI = Boolean(process.env.CI) && process.env.CI !== 'false';
// Skip CI, where the cache is unlikely to be reused.
if (enableCompileCache && !isCI) {
  try {
    // Do not propagate the cache directory to workers: concurrent cold-cache
    // writes can delay their shutdown. Explicit NODE_COMPILE_CACHE is still inherited.
    enableCompileCache();
  } catch {
    // ignore errors
  }
}

async function main() {
  const { runCLI } = await import('../dist/api/index.js');
  runCLI();
}

main();
