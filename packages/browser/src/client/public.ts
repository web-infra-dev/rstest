/**
 * Re-export runtime API from @rstest/core/browser-runtime for browser use.
 * This file is used as an alias target for '@rstest/core' in browser mode.
 *
 * Uses @rstest/core/browser-runtime which only exports the test APIs
 * (describe, it, expect, etc.) without any Node.js dependencies.
 */

// Re-export types from @rstest/core (these are compile-time only)
export type { Assertion, Mock } from '@rstest/core';
// Re-export all public test APIs
export * from '@rstest/core/browser-runtime';
