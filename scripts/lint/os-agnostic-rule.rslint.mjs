import { defineConfig } from '@rslint/core';
import { osAgnosticTests } from '../../rslint.config.mts';

// Minimal config for scripts/os-agnostic-rule.test.ts: mounts the real rule but
// omits `parserOptions.project`, so lintText skips the type-aware program the
// main config builds. The rule is purely syntactic, so this changes nothing it
// reports (~85ms per lint vs ~900ms with the project). No `files` scope — the
// test drives fixtures through lintText directly, so the rule applies to every
// linted buffer.
export default defineConfig([
  {
    plugins: { rstest: { rules: { 'os-agnostic-tests': osAgnosticTests } } },
    rules: { 'rstest/os-agnostic-tests': 'error' },
  },
]);
