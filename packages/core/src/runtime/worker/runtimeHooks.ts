/**
 * Magic-identifier contract between the build-time injection (rspack plugin in
 * `core/plugins/basic.ts`) and the VM worker loaders (`loadModule.ts` /
 * `loadEsModule.ts`).
 *
 * The bundle rewrites `import()` / `require.resolve()` callees to these names,
 * and the worker exposes byte-identical names in VM scope (CJS) or on
 * `import.meta` (ESM). Owning the spelling here keeps the emit and consume sides
 * from drifting. These identifiers are VM-internal and must stay out of every
 * public/internal barrel.
 */
export const RSTEST_DYNAMIC_IMPORT_HOOK = '__rstest_dynamic_import__' as const;
export const RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK =
  '__rstest_dynamic_import_origin__' as const;
export const RSTEST_REQUIRE_RESOLVE_HOOK =
  '__rstest_require_resolve__' as const;

/**
 * The federation fallback, parked while a non-federation file runs. Worker-wide,
 * matching the lifetime of the global it is taken from, and single-slot because
 * `mockRuntimeCode.js` installs under `hook = hook || fallback` — once one
 * project's runtime chunk has installed the fallback, every later project sees a
 * truthy global and skips its own.
 */
let retainedDynamicImportHook: unknown;

/**
 * Point the federation dynamic-import fallback at the source file currently
 * being loaded, so relative specifiers reaching `globalThis` resolve against it,
 * and keep the fallback itself visible only to federation files.
 *
 * Hiding it is a strict opt-in contract: a non-federation file must not be able
 * to observe or invoke another project's shim. But hiding cannot mean discarding
 * — `clearModuleCache` keeps evaluated runtime chunks alive, so a project that
 * has already run never re-executes its install, and a discarded hook would
 * strand that project's remaining files on an unresolved free identifier.
 * Retaining and restoring satisfies both.
 *
 * The origin needs no such treatment: it is re-established before every
 * federation file. Clearing it is still worthwhile, since a stale origin from
 * another project would silently resolve relative specifiers against the wrong
 * directory instead of deferring to Node's native `import()`.
 */
export const setFederationDynamicImportOrigin = (
  federation: boolean,
  origin: string,
): void => {
  const runtimeGlobal = globalThis as Record<string, unknown>;
  if (federation) {
    if (
      runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK] === undefined &&
      retainedDynamicImportHook !== undefined
    ) {
      runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK] = retainedDynamicImportHook;
    }
    runtimeGlobal[RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK] = origin;
  } else {
    delete runtimeGlobal[RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK];
    if (runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK] !== undefined) {
      retainedDynamicImportHook = runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK];
      delete runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK];
    }
  }
};

/**
 * Derive the `import.meta.`-prefixed emit form used in the ESM / `outputModule`
 * path (the bare form is used for the CJS path).
 */
export const importMetaHook = (name: string): string => `import.meta.${name}`;
