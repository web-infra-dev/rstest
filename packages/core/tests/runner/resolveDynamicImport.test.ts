import { pathToFileURL } from 'node:url';
import {
  clearModuleCache as clearEsModuleCache,
  loadModule as loadEsModule,
} from '../../src/runtime/worker/loadEsModule';
import {
  clearModuleCache as clearCjsModuleCache,
  loadModule as loadCjsModule,
} from '../../src/runtime/worker/loadModule';
import {
  finalizeDynamicImport,
  resolveImportSpecifier,
} from '../../src/runtime/worker/resolveDynamicImport';
import {
  importMetaHook,
  RSTEST_DYNAMIC_IMPORT_HOOK,
} from '../../src/runtime/worker/runtimeHooks';

describe('resolveImportSpecifier', () => {
  const testPath = '/virtual/tests/runtime.test.ts';

  it('normalizes bare builtins to their `node:` canonical form', () => {
    // Already-prefixed builtins are unchanged (no double prefix).
    expect(
      resolveImportSpecifier({
        specifier: 'node:fs',
        origin: undefined,
        testPath,
      }),
    ).toBe('node:fs');
    // Bare builtins are normalized so `import('path')` and `import('node:path')`
    // share one SyntheticModule cache key on the returnModule path.
    expect(
      resolveImportSpecifier({
        specifier: 'path',
        origin: undefined,
        testPath,
      }),
    ).toBe('node:path');
    // Slash subpaths (e.g. `fs/promises`) are builtins too.
    expect(
      resolveImportSpecifier({
        specifier: 'fs/promises',
        origin: undefined,
        testPath,
      }),
    ).toBe('node:fs/promises');
  });

  it('returns a file:// href for absolute specifiers (Windows-safe)', () => {
    const abs = '/abs/dir/foo.mjs';
    expect(
      resolveImportSpecifier({ specifier: abs, origin: undefined, testPath }),
    ).toBe(pathToFileURL(abs).href);
  });
});

describe('finalizeDynamicImport — node: interop skip', () => {
  // Regression for the drift this module collapsed: the `node:` interop-skip
  // used to live only on the ESM loader, so a CJS `import('node:fs')` was
  // interop-wrapped (a Proxy) while the ESM path returned the real namespace.
  // A builtin namespace must come back un-wrapped, so the result is identity-
  // equal to a direct `import()` rather than a synthetic interop Proxy.
  it('does not interop-wrap a node: builtin namespace', async () => {
    const ns = await import('node:path');
    const result = await finalizeDynamicImport({
      modulePath: 'node:path',
      importAttributes: {},
      interopDefault: true,
    });

    expect(result).toBe(ns);
  });
});

describe('builtin spelling is canonicalized on the returnModule (link) path', () => {
  // `import x from 'path'` and `import x from 'node:path'` must link to the
  // SAME vm.SyntheticModule, matching Node where both resolve to one module.
  // asModule's smCache is keyed by the resolved id, so resolveImportSpecifier
  // has to hand both spellings the same `node:` id — otherwise the two would
  // become distinct module instances on the link / importModuleDynamically path.
  afterEach(() => {
    clearCjsModuleCache();
  });

  const link = (specifier: string) =>
    finalizeDynamicImport({
      modulePath: resolveImportSpecifier({
        specifier,
        origin: undefined,
        testPath: '/virtual/tests/runtime.test.ts',
      }),
      importAttributes: {},
      interopDefault: true,
      returnModule: true,
    });

  it('bare and node: spelling share one synthetic module', async () => {
    expect(await link('path')).toBe(await link('node:path'));
  });
});

describe('node: dynamic import is consistent across both worker loaders', () => {
  afterEach(() => {
    clearEsModuleCache();
    clearCjsModuleCache();
  });

  it('CJS loader returns the raw node: namespace', async () => {
    const exported = loadCjsModule({
      codeContent: `module.exports = ${RSTEST_DYNAMIC_IMPORT_HOOK}('node:path');`,
      distPath: '/virtual/dist/entry.js',
      testPath: '/virtual/tests/runtime.test.ts',
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(await exported).toBe(await import('node:path'));
  });

  it('ESM loader returns the raw node: namespace', async () => {
    const mod = await loadEsModule({
      codeContent: [
        `const path = await ${importMetaHook(RSTEST_DYNAMIC_IMPORT_HOOK)}('node:path');`,
        'export default path;',
      ].join('\n'),
      distPath: '/virtual/dist/entry.mjs',
      testPath: '/virtual/tests/runtime.test.ts',
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(mod.default).toBe(await import('node:path'));
  });
});
