import vm from 'node:vm';
import { expect } from '@rstest/core';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';

expect.extend(jestDomMatchers);

// Force Module Federation runtime to use the node-like loader in JSDOM so remoteEntry
// executes via fetch + vm instead of DOM script injection.
//
// MF SDK checks `ENV_TARGET` as an unscoped identifier (not `globalThis.ENV_TARGET`),
// so define it via `vm.runInThisContext` to ensure it is visible.
(globalThis as any).ENV_TARGET = 'node';
try {
  vm.runInThisContext("var ENV_TARGET = 'node'");
} catch {
  // best effort
}
