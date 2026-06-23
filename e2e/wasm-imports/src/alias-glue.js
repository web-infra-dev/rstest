// Glue for aliasmod.wasm, reached through a `resolve.alias` (see the e2e root
// config's `@e2e/wasm-glue` entry). It exercises the loader wiring an
// import-module whose specifier is NOT relative (`./ ../ /`): the old
// prefix heuristic dropped these, actual resolution wires them.
export function imp() {
  return 42;
}
