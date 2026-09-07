#!/usr/bin/env node
import nodeModule from 'node:module';

// enable on-disk code caching and share its directory with child workers
// requires Nodejs >= 22.8.0
const { enableCompileCache, constants } = nodeModule;
if (enableCompileCache) {
  try {
    const { directory, status } = enableCompileCache();
    // ALREADY_ENABLED returns the active version-specific cache directory.
    // Passing it to workers would append another version directory.
    if (directory && status === constants.compileCacheStatus.ENABLED) {
      process.env.NODE_COMPILE_CACHE = directory;
    }
  } catch {
    // ignore errors
  }
}

async function main() {
  const { runCLI } = await import('../dist/api/index.js');
  runCLI();
}

main();
