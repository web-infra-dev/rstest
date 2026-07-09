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
export const RSTEST_REQUIRE_RESOLVE_HOOK =
  '__rstest_require_resolve__' as const;

/**
 * Derive the `import.meta.`-prefixed emit form used in the ESM / `outputModule`
 * path (the bare form is used for the CJS path).
 */
export const importMetaHook = (name: string): string => `import.meta.${name}`;
