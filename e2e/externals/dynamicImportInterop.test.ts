import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Runtime-computed specifier so rspack rewrites `import()` to
// `__rstest_dynamic_import__()`. Static-literal `import('./...')` would be
// bundled into a chunk and short-circuit the interop path that handles
// CJS-as-ESM dynamic imports.
const dyn = (rel: string) => import(join(__dirname, rel));

// Bundled dynamic imports retain Rstest's interop view across pools, including
// the original property descriptors of transpiled CommonJS exports.
describe('dynamic-imported CJS namespace', () => {
  describe('webpack-style __esModule with only named exports', () => {
    it('exposes named keys directly', async () => {
      const ns: any = await dyn('./dynamic-import-interop/webpackStyle.cjs');
      expect(ns.bar).toBe('bar');
      expect(ns.foo).toBe('foo');
    });

    it('exposes a default (no inner `.default` → the module.exports)', async () => {
      const ns: any = await dyn('./dynamic-import-interop/webpackStyle.cjs');
      expect('default' in ns).toBe(true);
      expect(ns.default).toBeDefined();
      // Whatever default is, it should expose the same named keys.
      expect(ns.default.bar).toBe('bar');
      expect(ns.default.foo).toBe('foo');
    });

    it('lists default + named keys in Object.keys', async () => {
      const ns: any = await dyn('./dynamic-import-interop/webpackStyle.cjs');
      expect(Object.keys(ns).sort()).toEqual(['bar', 'default', 'foo']);
    });

    it('serializes to a stable pretty-format shape', async () => {
      const ns: any = await dyn('./dynamic-import-interop/webpackStyle.cjs');
      // Snapshot intentionally empty — inspected on first run to verify
      // it matches the user contract above before being committed.
      expect({ ...ns }).toMatchInlineSnapshot(`
        {
          "bar": "bar",
          "default": {
            "bar": "bar",
            "foo": "foo",
          },
          "foo": "foo",
        }
      `);
    });
  });

  describe('babel-style __esModule with `exports.default`', () => {
    it('unwraps `default` to the inner value', async () => {
      const ns: any = await dyn('./dynamic-import-interop/babelStyle.cjs');
      expect(typeof ns.default).toBe('function');
      expect(ns.default()).toBe('hello');
    });

    it('exposes named exports alongside default', async () => {
      const ns: any = await dyn('./dynamic-import-interop/babelStyle.cjs');
      expect(ns.a).toBe('world');
      expect('a' in ns).toBe(true);
      expect('default' in ns).toBe(true);
    });

    it('lists default + named keys in Object.keys', async () => {
      const ns: any = await dyn('./dynamic-import-interop/babelStyle.cjs');
      expect(Object.keys(ns).sort()).toEqual(['a', 'default']);
    });
  });

  describe('plain CJS (no __esModule)', () => {
    it('exposes named exports', async () => {
      const ns: any = await dyn('./dynamic-import-interop/plain.cjs');
      expect(ns.foo).toBe('foo');
      expect(ns.bar).toBe('bar');
    });

    it('exposes module.exports as default', async () => {
      const ns: any = await dyn('./dynamic-import-interop/plain.cjs');
      expect(ns.default).toBeDefined();
      expect(ns.default.foo).toBe('foo');
      expect(ns.default.bar).toBe('bar');
    });

    it('lists default + named keys in Object.keys', async () => {
      const ns: any = await dyn('./dynamic-import-interop/plain.cjs');
      // Node 24 adds an internal `'module.exports'` key to CJS-via-ESM
      // namespaces that earlier versions don't surface; assert the
      // user-meaningful subset and ignore implementation-detail keys.
      expect(Object.keys(ns)).toEqual(
        expect.arrayContaining(['bar', 'default', 'foo']),
      );
    });
  });
});

it.each(['webpackStyle', 'babelStyle'])(
  'preserves the non-enumerable __esModule marker for %s',
  async (name) => {
    const ns = await dyn(`./dynamic-import-interop/${name}.cjs`);
    expect(ns.__esModule).toBe(true);
    expect(Object.getOwnPropertyDescriptor(ns, '__esModule')).toMatchObject({
      value: true,
      enumerable: false,
    });
    expect('module.exports' in ns).toBe(false);
    const again = await dyn(`./dynamic-import-interop/${name}.cjs`);
    expect(again.default).toBe(ns.default);
  },
);
