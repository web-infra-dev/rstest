import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'pathe';
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

const getFederationFallbackCode = () => {
  const source = readFileSync(
    join(__dirname, '../../src/core/plugins/mockRuntimeCode.js'),
    'utf-8',
  );
  const start = source.indexOf('//#region federation dynamic import fallback');
  const end = source.indexOf('//#endregion', start);

  return source.slice(start, end + '//#endregion'.length);
};

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

describe('federation dynamic import fallback', () => {
  it('resolves relative specifiers against the injected origin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rstest-federation-import-'));
    try {
      const depPath = join(dir, 'dep.mjs');
      const origin = join(dir, 'source.mjs');
      writeFileSync(depPath, 'export const marker = "from-origin";');

      const runtimeGlobal = {
        __rstest_federation__: true,
      } as {
        __rstest_federation__: boolean;
        __rstest_dynamic_import__?: (
          specifier: string,
          importAttributes: ImportCallOptions,
          origin?: string,
        ) => Promise<{ marker: string }>;
      };

      new Function('globalThis', getFederationFallbackCode())(runtimeGlobal);

      const mod = await runtimeGlobal.__rstest_dynamic_import__?.(
        './dep.mjs',
        {},
        origin,
      );

      expect(mod?.marker).toBe('from-origin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves bare specifiers against the injected origin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rstest-federation-import-'));
    try {
      const packageDir = join(dir, 'node_modules', 'origin-only-pkg');
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        JSON.stringify({ main: 'index.mjs' }),
      );
      writeFileSync(
        join(packageDir, 'index.mjs'),
        'export const marker = "from-origin-package";',
      );

      const runtimeGlobal = {
        __rstest_federation__: true,
      } as {
        __rstest_federation__: boolean;
        __rstest_dynamic_import__?: (
          specifier: string,
          importAttributes: ImportCallOptions,
          origin?: string,
        ) => Promise<{ marker: string }>;
      };

      new Function('globalThis', getFederationFallbackCode())(runtimeGlobal);

      const mod = await runtimeGlobal.__rstest_dynamic_import__?.(
        'origin-only-pkg',
        {},
        join(dir, 'src', 'source.mjs'),
      );

      expect(mod?.marker).toBe('from-origin-package');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
