import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asModule } from '../../src/runtime/worker/interop';
import {
  appendSourceURL,
  clearModuleCache,
  loadModule,
  shouldInjectSourceURL,
} from '../../src/runtime/worker/loadEsModule';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) => resolve(__dirname, 'fixtures', name);

describe('loadEsModule', () => {
  afterEach(() => {
    clearModuleCache();
  });

  it('should link nested modules that statically import builtins', async () => {
    const testPath = '/virtual/tests/runtime.test.ts';
    const distPath = '/virtual/dist/entry.mjs';
    const chunkPath = '/virtual/dist/chunk.mjs';

    const mod = await loadModule({
      codeContent: [
        "import chunk, { separator } from './chunk.mjs';",
        'export default {',
        '  hasReadFile: chunk,',
        '  separator,',
        '};',
      ].join('\n'),
      distPath,
      testPath,
      rstestContext: {},
      assetFiles: {
        [chunkPath]: [
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          'export const separator = path.sep;',
          "export default typeof fs.readFile === 'function';",
        ].join('\n'),
      },
      interopDefault: false,
    });

    expect(mod.default).toEqual({
      hasReadFile: true,
      separator: sep,
    });
  });

  it('should append sourceURL for esm vm execution', () => {
    expect(appendSourceURL("throw new Error('x')", '/virtual/dist/entry.mjs'))
      .toMatchInlineSnapshot(`
      "throw new Error('x')
      //# sourceURL=/virtual/dist/entry.mjs"
    `);
  });

  it('should not duplicate an existing sourceURL comment', () => {
    const code = [
      "throw new Error('x')",
      '//# sourceURL=/virtual/dist/original.mjs',
    ].join('\n');

    expect(appendSourceURL(code, '/virtual/dist/entry.mjs')).toBe(code);
  });

  // Regression: native ESM modules with only named exports (no `export default`)
  // must not grow a phantom `default` key after being wrapped by asModule.
  // Refs: rslib ecosystem-ci failures on rstest PR #1171 — snapshots of
  // `import * as m from '<esm-named-only>'` gained a self-referential
  // `default: namespace` key because the asModule wrap synthesized one via
  // `something['default'] ?? something`.
  it('should not synthesize a phantom default when the source has only named exports', async () => {
    const namespace = { foo: 'foo-val', bar: 'bar-val' };
    const sm = await asModule(namespace, '/fake/id/named-only');

    expect(Object.keys(sm.namespace).sort()).toEqual(['bar', 'foo']);
    expect('default' in sm.namespace).toBe(false);
  });

  it('should expose the real default export when the source has both default and named exports', async () => {
    const defaultVal = { marker: 'real-default' };
    const namespace = { default: defaultVal, foo: 'foo-val' };
    const sm = await asModule(namespace, '/fake/id/default-and-named');

    expect(Object.keys(sm.namespace).sort()).toEqual(['default', 'foo']);
    expect(sm.namespace.default).toBe(defaultVal);
    expect(sm.namespace.foo).toBe('foo-val');
  });

  it('should reuse the cached SyntheticModule for the same resolved id', async () => {
    const sm1 = await asModule({ foo: 'a' }, '/cache/shared');
    const sm2 = await asModule({ bar: 'b' }, '/cache/shared');

    expect(sm2).toBe(sm1);
  });

  it('should not pollute the namespace of a real native ESM module with only named exports', async () => {
    const mod = await loadModule({
      codeContent: [
        `import * as m from ${JSON.stringify(fixturePath('namedOnly.mjs'))};`,
        'export default m;',
      ].join('\n'),
      distPath: '/virtual/dist/entry.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(Object.keys(mod.default).sort()).toEqual(['bar', 'foo']);
    expect('default' in mod.default).toBe(false);
    expect(mod.default.foo).toBe('foo-val');
    expect(mod.default.bar).toBe('bar-val');
  });

  it('should resolve external ESM after Node native TypeScript loader is used', async () => {
    await import(fixturePath('nativeTsLoader.ts'));

    const mod = await loadModule({
      codeContent: [
        `import { foo } from ${JSON.stringify(fixturePath('namedOnly.mjs'))};`,
        'export default foo;',
      ].join('\n'),
      distPath: '/virtual/dist/entry.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(mod.default).toBe('foo-val');
  });

  it('should resolve bare static imports from the test path', async () => {
    const testPath = fixturePath('bare-parent/index.test.ts');
    const distPath = '/virtual/dist/.rstest-temp/bare-parent_index~test~ts.mjs';

    const mod = await loadModule({
      codeContent: [
        "import { value } from '#fixture-pkg';",
        'export default value;',
      ].join('\n'),
      distPath,
      testPath,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(mod.default).toBe('fixture-pkg-value');
  });

  it('should preserve the real default export of a real native ESM module', async () => {
    const mod = await loadModule({
      codeContent: [
        `import * as m from ${JSON.stringify(fixturePath('defaultAndNamed.mjs'))};`,
        'export default m;',
      ].join('\n'),
      distPath: '/virtual/dist/entry.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(Object.keys(mod.default).sort()).toEqual(['default', 'foo']);
    expect(mod.default.default).toEqual({ marker: 'real-default' });
    expect(mod.default.foo).toBe('foo-val');
  });

  // Regression: https://github.com/web-infra-dev/rstest/issues/1376
  // Under `isolate: false` the pool has no environment affinity, so a reused
  // worker can serve project A, then B, then A again. `clearModuleCache(keep)`
  // must accumulate every project's runtime chunk — keeping only the latest id
  // would let B's teardown evict A's runtime chunk and re-evaluate A's shared
  // modules on its next file.
  it('keeps every reused project runtime chunk across files', async () => {
    const g = globalThis as Record<string, any>;
    g.__evalA = 0;
    g.__evalB = 0;
    g.__evalEntry = 0;

    const runtimeA = '/virtual/dist/runtimeA.mjs';
    const runtimeB = '/virtual/dist/runtimeB.mjs';
    const entry = '/virtual/dist/entry.mjs';

    // Each module bumps its global counter when its body runs, so a cached
    // (kept) module returns the same `default` while an evicted one re-runs.
    const load = (distPath: string, counter: string) =>
      loadModule({
        codeContent: [
          `globalThis.${counter} += 1;`,
          `export default globalThis.${counter};`,
        ].join('\n'),
        distPath,
        testPath: distPath,
        rstestContext: {},
        assetFiles: {},
        interopDefault: false,
      });

    // Project A's first file: load its runtime chunk and a (never-kept) entry.
    await load(runtimeA, '__evalA');
    await load(entry, '__evalEntry');
    clearModuleCache(runtimeA);

    // Project B runs on the same worker; its teardown must NOT evict A.
    await load(runtimeB, '__evalB');
    clearModuleCache(runtimeB);

    // Project A's next file: its runtime chunk is still cached (state shared),
    // while the entry — never kept — was re-evaluated.
    expect((await load(runtimeA, '__evalA')).default).toBe(1);
    expect((await load(runtimeB, '__evalB')).default).toBe(1);
    expect((await load(entry, '__evalEntry')).default).toBe(2);

    delete g.__evalA;
    delete g.__evalB;
    delete g.__evalEntry;
  });

  it('should only inject sourceURL in Bun runtime', async () => {
    const originalBunVersion = process.versions.bun;

    try {
      Reflect.deleteProperty(process.versions, 'bun');
      expect(shouldInjectSourceURL()).toBe(false);

      process.versions.bun = originalBunVersion ?? '1.0.0';
      expect(shouldInjectSourceURL()).toBe(true);
    } finally {
      if (originalBunVersion === undefined) {
        Reflect.deleteProperty(process.versions, 'bun');
      } else {
        process.versions.bun = originalBunVersion;
      }
    }
  });
});
