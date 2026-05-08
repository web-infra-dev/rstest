import {
  createInteropProxy,
  interopModule,
} from '../../src/runtime/worker/interop';

// Build a Module-Namespace-shaped object matching what Node's CJS-as-ESM
// importer produces (verified against `node --input-type=module` against
// real .cjs fixtures). `default` is always `module.exports` (Node never
// uses the lexer-detected `default` value for the namespace's default
// slot); other lexer-detected named keys appear as enumerable own keys.
const buildNamespace = (cjsExports: any, namedKeys: string[]) => {
  const ns: any = { default: cjsExports };
  for (const k of namedKeys) {
    if (k === 'default') continue;
    ns[k] = cjsExports[k];
  }
  if ('__esModule' in cjsExports) ns.__esModule = cjsExports.__esModule;
  return ns;
};

// Run the dynamic-import interop pipeline for a CJS-shaped Node namespace.
// This is the path `meta.__rstest_dynamic_import__` takes for non-builtin,
// non-asset specifiers.
const interop = (importedModule: any) => {
  const { mod, defaultExport } = interopModule(importedModule);
  return createInteropProxy(mod, defaultExport);
};

// User contract for a dynamic-imported CJS namespace:
// - `default` is always present (CJS interop convention; Babel/TS/vitest all
//   guarantee this). For `__esModule` + `exports.default = X`, `default` is
//   unwrapped to X. Otherwise `default` is `module.exports`.
// - Named exports are reachable directly (`ns.foo`).
// - `__esModule` is an internal interop signal, not a user-facing export —
//   it should NOT appear in enumeration.
// - `Object.keys` / spread / pretty-format must agree with `get` / `has`.
describe('dynamic-import CJS interop pipeline', () => {
  describe('webpack/rspack-style: __esModule + named, no inner default', () => {
    const cjsExports: any = { bar: 'bar', foo: 'foo' };
    Object.defineProperty(cjsExports, '__esModule', { value: true });
    const ns = interop(buildNamespace(cjsExports, ['bar', 'foo']));

    it('exposes named exports and default', () => {
      expect(ns.bar).toBe('bar');
      expect(ns.foo).toBe('foo');
      expect('default' in ns).toBe(true);
      expect(ns.default).toBeDefined();
      // No inner default → `default` carries `module.exports`, so the same
      // named keys are reachable through it.
      expect(ns.default.bar).toBe('bar');
    });

    it('does not leak __esModule into enumeration', () => {
      expect(Object.keys(ns).sort()).toEqual(['bar', 'default', 'foo']);
      expect(Object.keys(ns)).not.toContain('__esModule');
    });

    it('describes default as enumerable + configurable', () => {
      const d = Object.getOwnPropertyDescriptor(ns, 'default');
      expect(d).toMatchObject({ enumerable: true, configurable: true });
    });

    it('round-trips through spread without losing default (rslib format case)', () => {
      const spread: any = { ...ns };
      expect(spread.bar).toBe('bar');
      expect(spread.foo).toBe('foo');
      expect('default' in spread).toBe(true);
    });
  });

  describe('babel/TS-style: __esModule + exports.default = X', () => {
    const fn = () => 'hello';
    const cjsExports: any = { a: 'world', default: fn };
    Object.defineProperty(cjsExports, '__esModule', { value: true });
    const ns = interop(buildNamespace(cjsExports, ['a', 'default']));

    it('unwraps default to the inner value (Babel/vitest convention)', () => {
      expect(ns.default).toBe(fn);
      expect(ns.default()).toBe('hello');
    });

    it('exposes named exports alongside default', () => {
      expect(ns.a).toBe('world');
      expect(Object.keys(ns).sort()).toEqual(['a', 'default']);
    });
  });

  // Regression: frozen `module.exports` — see `createInteropProxy` JSDoc
  // for the Proxy invariant trade-off this scenario exercises.
  describe('frozen module.exports', () => {
    const cjsExports: any = { foo: 'foo', bar: 'bar' };
    Object.defineProperty(cjsExports, '__esModule', { value: true });
    Object.freeze(cjsExports);
    const ns = interop(buildNamespace(cjsExports, ['foo', 'bar']));

    it('does not throw on Object.keys / spread / descriptor lookup', () => {
      expect(() => Object.keys(ns)).not.toThrow();
      expect(() => ({ ...ns })).not.toThrow();
      expect(() =>
        Object.getOwnPropertyDescriptor(ns, 'default'),
      ).not.toThrow();
    });

    it('still resolves default via get and has', () => {
      expect(ns.default).toBe(cjsExports);
      expect('default' in ns).toBe(true);
    });

    it('omits `default` from enumeration as the documented trade-off', () => {
      expect(Object.keys(ns)).not.toContain('default');
      expect(Object.keys({ ...ns })).not.toContain('default');
    });

    it('exposes named exports', () => {
      expect(ns.foo).toBe('foo');
      expect(ns.bar).toBe('bar');
    });
  });

  describe('plain CJS: no __esModule', () => {
    const cjsExports = { foo: 'foo', bar: 'bar' };
    const ns = interop(buildNamespace(cjsExports, ['foo', 'bar']));

    it('uses module.exports as default', () => {
      expect(ns.default).toBe(cjsExports);
    });

    it('exposes named exports', () => {
      expect(ns.foo).toBe('foo');
      expect(ns.bar).toBe('bar');
      expect(Object.keys(ns).sort()).toEqual(['bar', 'default', 'foo']);
    });

    it('falls through to default for keys cjs-module-lexer missed', () => {
      // Construct a namespace where the lexer detected `foo` but missed `bar`
      // — i.e., `bar` exists on `module.exports` but not on the outer ns.
      const partial: any = { default: { foo: 'foo', bar: 'bar' }, foo: 'foo' };
      const lossy = interop(partial);
      expect(lossy.bar).toBe('bar');
      expect('bar' in lossy).toBe(true);
    });
  });
});
