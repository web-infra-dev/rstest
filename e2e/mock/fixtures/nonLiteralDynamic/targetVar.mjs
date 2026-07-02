// Imported ONLY via a non-literal `import(variable)` (see
// mockNonLiteralDynamicImport.test.ts) so it stays out of the bundle and is
// loaded by Node's loader — the #1454 off-graph case. Kept separate from
// `target.mjs` (which a literal import compiles into the bundle) so the two
// tests exercise distinct paths.
import { hostname } from 'node:os';

export const probe = () => hostname();
