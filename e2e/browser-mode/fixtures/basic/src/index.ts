/**
 * This file exists intentionally to test the default entry detection fix.
 *
 * Problem: When a project has `src/index.ts`, Rsbuild auto-detects it as the default entry
 * and generates `index.html`. Rsbuild's HTML fallback middleware then routes all unmatched
 * requests to this `index.html`, bypassing rstest's custom middleware that serves the test
 * container UI at `/`.
 *
 * Solution: rstest uses `modifyEnvironmentConfig` with `order: 'post'` to completely
 * overwrite the entry config, ensuring browser mode entry is fully controlled by rstest.
 *
 * See: packages/browser/src/hostController.ts
 */

export const placeholder = 'This file should not affect rstest browser mode';
