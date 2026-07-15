import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Stands in for a third-party TS loader (ts-node / tsx / @swc-node), which is
 * what the docs told users to register before `runtimeTsTransform` existed.
 * `require.extensions` IS `Module._extensions` — the same object rstest
 * snapshots at hook registration time.
 *
 * The wrapper stamps `__loadedBy` onto whatever it compiles, so a test can prove
 * the compile call reached THIS loader rather than rstest's load hook.
 */
createRequire(import.meta.url).extensions['.ts'] = (mod, filename) => {
  const source = readFileSync(filename, 'utf-8');
  (mod as unknown as { _compile: (c: string, f: string) => void })._compile(
    `${source}\nmodule.exports.__loadedBy = 'third-party-ts-extension';\n`,
    filename,
  );
};
