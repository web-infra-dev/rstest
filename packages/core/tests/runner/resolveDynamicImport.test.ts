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

describe('resolveImportSpecifier', () => {
  const testPath = '/virtual/tests/runtime.test.ts';

  it('keeps builtin specifiers verbatim (both `node:`-prefixed and bare)', () => {
    expect(
      resolveImportSpecifier({
        specifier: 'node:fs',
        origin: undefined,
        testPath,
      }),
    ).toBe('node:fs');
    expect(
      resolveImportSpecifier({
        specifier: 'path',
        origin: undefined,
        testPath,
      }),
    ).toBe('path');
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

describe('node: dynamic import is consistent across both worker loaders', () => {
  afterEach(() => {
    clearEsModuleCache();
    clearCjsModuleCache();
  });

  it('CJS loader returns the raw node: namespace', async () => {
    const exported = loadCjsModule({
      codeContent: `module.exports = __rstest_dynamic_import__('node:path');`,
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
        "const path = await import.meta.__rstest_dynamic_import__('node:path');",
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
