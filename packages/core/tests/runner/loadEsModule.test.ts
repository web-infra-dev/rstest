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
