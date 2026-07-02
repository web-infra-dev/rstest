import { describe, expect, it } from '@rstest/core';
import {
  importMetaHook,
  RSTEST_DYNAMIC_IMPORT_HOOK,
  RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK,
  RSTEST_REQUIRE_RESOLVE_HOOK,
  setFederationDynamicImportOrigin,
} from '../../../src/runtime/worker/runtimeHooks';

describe('runtime hook identifier contract', () => {
  it('pins the wire spelling shared by the rspack plugin and the VM loaders', () => {
    // These strings are a cross-tool contract: rspack rewrites import() /
    // require.resolve() callees to them and the VM loaders must expose the
    // byte-identical names. An accidental rename must break this unit test.
    expect(RSTEST_DYNAMIC_IMPORT_HOOK).toBe('__rstest_dynamic_import__');
    expect(RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK).toBe(
      '__rstest_dynamic_import_origin__',
    );
    expect(RSTEST_REQUIRE_RESOLVE_HOOK).toBe('__rstest_require_resolve__');
  });

  it('derives the import.meta emit form for the ESM path', () => {
    expect(importMetaHook(RSTEST_DYNAMIC_IMPORT_HOOK)).toBe(
      'import.meta.__rstest_dynamic_import__',
    );
    expect(importMetaHook(RSTEST_REQUIRE_RESOLVE_HOOK)).toBe(
      'import.meta.__rstest_require_resolve__',
    );
  });

  it('owns the federation dynamic import origin lifecycle', () => {
    const runtimeGlobal = globalThis as Record<string, unknown>;
    runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK] = () => undefined;

    setFederationDynamicImportOrigin(true, '/project/test.ts');

    expect(runtimeGlobal[RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK]).toBe(
      '/project/test.ts',
    );
    expect(runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK]).toBeUndefined();

    runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK] = () => undefined;

    setFederationDynamicImportOrigin(false, '/project/other.test.ts');

    expect(runtimeGlobal[RSTEST_DYNAMIC_IMPORT_ORIGIN_HOOK]).toBeUndefined();
    expect(runtimeGlobal[RSTEST_DYNAMIC_IMPORT_HOOK]).toBeUndefined();
  });
});
