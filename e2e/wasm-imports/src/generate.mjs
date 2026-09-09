// Regenerates the two minimal wasm fixtures used by ../index.test.ts.
// Run: `node src/generate.mjs`. Each module imports `<mod>.imp: () => i32`
// and exports `exp: () => i32` whose body is `call imp`.
import { writeFileSync } from 'node:fs';

const str = (s) => [s.length, ...[...s].map((c) => c.charCodeAt(0))];
const wasmImporting = (mod, name) => {
  const imp = [0x01, ...str(mod), ...str(name), 0x00, 0x00]; // import mod.name func t0
  return Buffer.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00, // magic + version
    0x01,
    0x05,
    0x01,
    0x60,
    0x00,
    0x01,
    0x7f, // type: () -> i32
    0x02,
    imp.length,
    ...imp, // import section
    0x03,
    0x02,
    0x01,
    0x00, // func: exp uses t0
    0x07,
    0x07,
    0x01,
    0x03,
    0x65,
    0x78,
    0x70,
    0x00,
    0x01, // export "exp" func#1
    0x0a,
    0x06,
    0x01,
    0x04,
    0x00,
    0x10,
    0x00,
    0x0b, // code: call 0; end
  ]);
};

// Resolvable glue import (wasm-bindgen --target bundler shape).
writeFileSync(
  new URL('./mod.wasm', import.meta.url),
  wasmImporting('./glue.js', 'imp'),
);
// Synthetic, non-resolvable import (emscripten/wasi shape).
writeFileSync(
  new URL('./envmod.wasm', import.meta.url),
  wasmImporting('env', 'imp'),
);
// Non-relative but resolvable import module: reaches its glue through a
// `resolve.alias` entry rather than a `./` path (see ../index.test.ts).
writeFileSync(
  new URL('./aliasmod.wasm', import.meta.url),
  wasmImporting('@e2e/wasm-glue', 'imp'),
);
