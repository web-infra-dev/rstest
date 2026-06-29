import { readFile } from 'node:fs/promises';
import {
  builtinModules,
  createRequire as createNativeRequire,
} from 'node:module';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  asModule,
  createInteropProxy,
  interopModule,
  shouldInterop,
} from './interop';

/**
 * Shared dynamic-import resolution + interop policy for both worker loaders.
 *
 * `loadModule.ts` (CJS, `vm.runInThisContext`) and `loadEsModule.ts` (ESM,
 * `vm.SourceTextModule`) used to each carry a private copy of this strategy,
 * and the copies had drifted — most visibly, the `node:` interop-skip existed
 * only on the ESM path, so a CJS `import('node:fs')` was interop-wrapped while
 * the same import on the ESM path was not. Centralizing the policy here keeps
 * the two `vm` state machines as the only genuine per-loader adapters; the
 * resolution rules and the post-import interop decision now live in one place.
 */

const importMetaResolve = import.meta.resolve?.bind(import.meta);

export const isBuiltinSpecifier = (specifier: string): boolean =>
  specifier.startsWith('node:') || builtinModules.includes(specifier);

/**
 * Normalize a builtin specifier to its `node:` canonical form. Node treats the
 * bare (`path`) and prefixed (`node:path`) spellings as one module, but the
 * `returnModule` path keys its `SyntheticModule` cache by this id, so a bare id
 * would split `import('path')` and `import('node:path')` into two distinct
 * module instances. Every `builtinModules` entry is importable with the `node:`
 * prefix, so prefixing is always safe.
 */
export const toNodeBuiltin = (specifier: string): string =>
  specifier.startsWith('node:') ? specifier : `node:${specifier}`;

const resolveModule = (specifier: string, resolveBase: string): string => {
  const parentURL = resolveBase.startsWith('file:')
    ? resolveBase
    : pathToFileURL(resolveBase).href;

  if (!importMetaResolve) {
    return pathToFileURL(createNativeRequire(parentURL).resolve(specifier))
      .href;
  }

  // Node's loader hook worker clones the parent URL when native TypeScript
  // loading is active. Passing URL objects can throw DataCloneError there.
  return importMetaResolve(specifier, parentURL);
};

/**
 * Resolve a dynamic-import specifier to the module path that Node's loader (or
 * the interop tail below) should consume.
 *
 * - Absolute specifiers are kept verbatim (as a `file://` href); builtins are
 *   normalized to their `node:` canonical form; everything else is resolved
 *   against the source module's origin.
 * - `origin` is the absolute path of the source module that produced the
 *   `import()` call, injected by rspack's `RstestPlugin` when
 *   `injectDynamicImportOrigin` is enabled, so relative specifiers in bundled
 *   deps resolve against the dep's own directory rather than the test entry's.
 *   Falling back to `testPath` keeps the vm `importModuleDynamically` / `link`
 *   callbacks (which have no origin to pass) working as before.
 */
export const resolveImportSpecifier = ({
  specifier,
  origin,
  testPath,
}: {
  specifier: string;
  origin: string | undefined;
  testPath: string;
}): string => {
  const resolveBase = origin ?? testPath;

  // Use `.href` (full file:// URL) rather than `.pathname` for absolute
  // specifiers so Windows paths (`D:\a\foo.mjs`) round-trip through Node's ESM
  // loader as valid `file:///D:/...` URLs instead of `/D:/...`, which Node
  // re-resolves as `D:\D:\...` (double drive letter).
  return isAbsolute(specifier)
    ? pathToFileURL(specifier).href
    : isBuiltinSpecifier(specifier)
      ? toNodeBuiltin(specifier)
      : resolveModule(specifier, resolveBase);
};

/**
 * #1454: a non-literal `import(request)` is routed to this worker's native
 * import hook, which loads outside the webpack runtime and so bypasses
 * `rs.mock`. When the `request` itself names a mocked module (e.g.
 * `const s = 'node:os'; import(s)`), the bundle's mock runtime publishes a
 * resolver on the shared global that maps the clean request to the
 * already-installed mocked instance. Consulting it before the native import
 * keeps `import(variable)` of a mocked module mock-aware on every Node version.
 *
 * Gated on `returnModule` being false: only the `import()` call site can reach a
 * mocked request — static imports are mock-rewritten in the bundle and never
 * hit the loaders. Also skipped for `importActual` (carried as the internal
 * `with: { rstest }` attribute), which must reach the REAL module — so
 * `rs.importActual(variable)` of a mocked module is never served the mock.
 * Returns `undefined` (caller falls through to a real native import) for a static
 * import, an `importActual`, or an unmocked request. Both loaders share this
 * single policy rather than re-implementing the gate at each call site.
 */
export const maybeResolveMockedDynamicImport = (
  specifier: string,
  returnModule: boolean | undefined,
  importAttributes?: ImportCallOptions,
): unknown => {
  if (returnModule || importAttributes?.with?.rstest) {
    return undefined;
  }
  const resolver = (
    globalThis as {
      __rstest_resolve_mocked_dynamic_request__?: (request: string) => unknown;
    }
  ).__rstest_resolve_mocked_dynamic_request__;
  return typeof resolver === 'function' ? resolver(specifier) : undefined;
};

/**
 * Compile and instantiate a `.wasm` module from its on-disk source, with no
 * importObject. This is the runtime path for `import(new URL('./x.wasm',
 * import.meta.url).href)` and other non-literal `.wasm` specifiers (#1455);
 * direct `import './x.wasm'` is instead turned into a self-contained module by
 * `wasmLoader.mjs`, which builds its own importObject and never reaches here.
 *
 * `Buffer.from` normalizes the read to an `ArrayBuffer`-backed buffer so it
 * satisfies `WebAssembly.compile`'s `BufferSource` (a raw `readFile` result is
 * typed as possibly `SharedArrayBuffer`-backed).
 */
export const loadWasm = async (
  filePath: string,
  returnModule?: boolean,
): Promise<any> => {
  const wasmModule = await WebAssembly.compile(
    Buffer.from(await readFile(filePath)),
  );
  const exports = (await WebAssembly.instantiate(wasmModule)).exports as Record<
    string,
    any
  >;
  // Node's WebAssembly ESM namespace exposes the wasm exports as named exports
  // with no synthetic `default` (`'default' in ns === false`), so pass no
  // default export — `returnModule` then matches that shape unless the wasm
  // itself exports a member named `default`.
  return returnModule ? asModule(exports, filePath) : exports;
};

/**
 * Import an already-resolved module path and apply the CJS-interop policy.
 *
 * `returnModule` selects the wrap strategy required by each vm adapter:
 * - `true`  — wrap the result in a `vm.SyntheticModule` (for `link` /
 *   `importModuleDynamically` results that must join the module graph).
 * - `false` — return the namespace (or an interop Proxy) directly for the
 *   `import()` call site.
 *
 * Builtin namespaces are never interop-wrapped — both the `node:`-prefixed and
 * the bare spelling (`path`, `fs/promises`), so `import('path')` and
 * `import('node:path')` resolve identically. Node already exposes a proper
 * namespace with named + default exports, and `interopModule` is a no-op for
 * them (their default carries no `__esModule`), so wrapping would only add a
 * redundant, transparent Proxy. `isBuiltinSpecifier` keeps both spellings on
 * the same branch.
 */
export const finalizeDynamicImport = async ({
  modulePath,
  importAttributes,
  interopDefault,
  returnModule,
}: {
  modulePath: string;
  importAttributes: ImportCallOptions;
  interopDefault: boolean;
  returnModule?: boolean;
}): Promise<any> => {
  // Rstest importAttributes is used internally to distinguish `importActual`
  // and normal imports, and should not be passed to Node.js side, otherwise it
  // will cause ERR_IMPORT_ATTRIBUTE_UNSUPPORTED error.
  if (importAttributes?.with?.rstest) {
    delete importAttributes.with.rstest;
  }

  if (modulePath.endsWith('.json')) {
    // `await import(jsonPath)` should return `{ default: jsonExports, ...jsonExports }`.
    const importedModule = await import(modulePath, {
      with: { type: 'json' },
    });

    return returnModule
      ? asModule(importedModule.default, modulePath, importedModule.default)
      : {
          ...importedModule.default,
          default: importedModule.default,
        };
  }

  const importedModule = await import(modulePath, importAttributes);

  if (
    shouldInterop({
      interopDefault,
      modulePath,
      mod: importedModule,
    }) &&
    !isBuiltinSpecifier(modulePath)
  ) {
    const { mod, defaultExport } = interopModule(importedModule);
    if (returnModule) {
      return asModule(mod, modulePath, defaultExport);
    }

    return createInteropProxy(mod, defaultExport);
  }

  if (returnModule) {
    return asModule(importedModule, modulePath, importedModule.default);
  }
  return importedModule;
};
