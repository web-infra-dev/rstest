// Build-time loader for `.wasm`. With `experiments.asyncWebAssembly` disabled,
// `.wasm` is no longer a special module type, so this loader turns each wasm
// into a plain JS module that reads its on-disk SOURCE bytes and instantiates
// them, re-exporting the wasm exports as named exports (#1455).
//
// Notes on the emitted shape:
// - `node:fs` stays external in the node-target bundle, so `readFileSync` hits
//   the real builtin and the bytes come from the source path on disk.
// - `await` on `instantiate` is load-bearing: deferring past the synchronous
//   link phase is what lets a statically-imported glue module's hoisted
//   declarations be bound when the wasm links — which is how the circular
//   wasm-bindgen `--target bundler` case (foo_bg.wasm <-> foo_bg.js) resolves.
//   A synchronous `new WebAssembly.Instance` would instantiate too early.
// - The importObject maps each resolvable import-module to its WHOLE glue
//   namespace; `instantiate` only reads the declared `(module, name)` pairs and
//   ignores extra members, so per-name enumeration is unnecessary.
// - An import-module is wired only if it actually resolves through rspack's
//   resolver (relative, bare, or aliased — same resolution the emitted static
//   `import` will use). Synthetic host modules that do not resolve (emscripten
//   `env`, `wasi_snapshot_preview1`, `GOT.*`) are omitted rather than emitted as
//   `import * as g from 'env'`, which would turn a build-passing file into a
//   "Module not found" build error; such a wasm still builds and only LinkErrors
//   at runtime if it truly needs them (use the wasm's JS glue instead).
// - Exports use positional locals + string export specifiers because wasm export
//   names need not be valid JS identifiers.
// - A content-hash comment is prepended so the emitted module changes whenever
//   the wasm bytes change even if its imports/exports are identical. Watch-mode
//   rerun selection is driven by entry chunk hashes, which derive from this
//   loader output rather than the raw bytes, so without it a wasm-importing test
//   could be skipped after the wasm was rebuilt.
import { createHash } from 'node:crypto';

export const raw = true;

export default async function rstestWasmLoader(buffer) {
  const wasmModule = new WebAssembly.Module(buffer);
  const source = JSON.stringify(this.resourcePath);
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  const names = WebAssembly.Module.exports(wasmModule).map(
    (entry) => entry.name,
  );
  const bindings = names
    .map(
      (name, i) =>
        `const __rstest_wasm_${i}__ = __rstest_wasm_ns__[${JSON.stringify(name)}];`,
    )
    .join('\n');
  const exportList = names
    .map((name, i) => `__rstest_wasm_${i}__ as ${JSON.stringify(name)}`)
    .join(', ');

  // Distinct import-modules declared by the wasm. Resolve each through rspack's
  // normal-module resolver so relative, bare, and aliased specifiers are all
  // wired; specifiers that do not resolve (synthetic host modules) are dropped.
  const importModules = [
    ...new Set(
      WebAssembly.Module.imports(wasmModule).map((entry) => entry.module),
    ),
  ];
  const resolve = this.getResolve();
  const resolved = await Promise.all(
    importModules.map((module) =>
      resolve(this.context, module).then(
        () => module,
        () => null,
      ),
    ),
  );

  // Each resolvable import-module is statically imported and passed as a whole
  // namespace in the importObject.
  const modules = resolved.filter((module) => module !== null);
  const glueImports = modules.map(
    (module, i) =>
      `import * as __rstest_wasm_glue_${i}__ from ${JSON.stringify(module)};`,
  );
  const importObject = modules
    .map((module, i) => `${JSON.stringify(module)}: __rstest_wasm_glue_${i}__`)
    .join(', ');

  return [
    `// rstest:wasm-content ${contentHash}`,
    'import { readFileSync as __rstest_read_wasm__ } from "node:fs";',
    ...glueImports,
    `const { instance: __rstest_wasm_instance__ } = await WebAssembly.instantiate(__rstest_read_wasm__(${source}), { ${importObject} });`,
    'const __rstest_wasm_ns__ = __rstest_wasm_instance__.exports;',
    bindings,
    `export { ${exportList} };`,
    '',
  ].join('\n');
}
