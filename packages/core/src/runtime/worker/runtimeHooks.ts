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
 * Point the federation dynamic-import fallback at the source file currently
 * being loaded, so relative specifiers reaching `globalThis` resolve against it.
 *
 * Only the origin is per-file — never delete `RSTEST_DYNAMIC_IMPORT_HOOK` here.
 * A project's runtime chunk installs it as `hook = hook || fallback`, and
 * `clearModuleCache` keeps evaluated runtime chunks alive, so re-entering that
 * project never re-runs the install. Under `isolate: false` a non-federation
 * file that dropped the hook on its way past would strand the federation
 * project's remaining files on an unresolved free identifier. (Only a project
 * whose runtime chunk has not run yet reinstalls it, so the hazard is an
 * interleaving rather than every mixed run.)
 *
 * Leaving it installed is inert: normally-loaded modules get the hook as a VM
 * argument that shadows the global, and a cleared origin makes the fallback
 * defer to Node's native `import()`.
 */
export const setFederationDynamicImportOrigin = (
  federation: boolean,
  origin: string,
): void => {
  const runtimeGlobal = globalThis as Record<string, unknown>;
  if (federation) {
    runtimeGlobal[RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK] = origin;
  } else {
    delete runtimeGlobal[RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK];
  }
};

/**
 * Derive the `import.meta.`-prefixed emit form used in the ESM / `outputModule`
 * path (the bare form is used for the CJS path).
 */
export const importMetaHook = (name: string): string => `import.meta.${name}`;
