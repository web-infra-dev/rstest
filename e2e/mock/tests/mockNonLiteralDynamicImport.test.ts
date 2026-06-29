import nodeModule from 'node:module';
import { describe, expect, it, rs } from '@rstest/core';

// Regression for #1454: rs.mock must reach the inner imports of a module loaded
// via a NON-LITERAL dynamic `import(variable)`. rspack cannot statically include
// such a target, so Node loads it outside the bundle; only the in-thread
// `module.registerHooks` path (Node >= 22.15 / >= 23.5) can redirect the
// target's `import 'node:os'` to the mock. The literal-import control compiles
// the target into the bundle and is mock-aware on all Node.
const HAS_REGISTER_HOOKS =
  typeof (nodeModule as { registerHooks?: unknown }).registerHooks ===
  'function';

rs.mock('node:os', () => ({ hostname: () => 'MOCKED' }));
rs.mock('strip-ansi', () => ({ default: () => 'MOCKED_STRIP' }));
// Manual mock from `__mocks__/dns.ts` (no factory) — exercises that a manual
// mock is published to the native registry too.
rs.mock('node:dns');
// Factory returning a class — exercises that the synthetic native-mock module
// keeps the export constructible.
rs.mock('../fixtures/nonLiteralDynamic/classDep.mjs', () => {
  class Service {
    greet() {
      return 'MOCKED_CLASS';
    }
  }
  return { Service };
});
// Function factory with an observable side effect — proves the factory runs
// LAZILY (only when a natively-loaded module imports it), not eagerly at
// registration time. The counter lives on the shared globalThis (same object in
// the bundle and worker realms), so both sides increment/read the same value.
const fxCounter = globalThis as { __rstestFxCalls?: number };
rs.mock('../fixtures/nonLiteralDynamic/sideEffectDep.mjs', () => {
  fxCounter.__rstestFxCalls = (fxCounter.__rstestFxCalls ?? 0) + 1;
  return { value: 'MOCKED_FX' };
});
// Async factory: the synchronous native load hook can't produce its exports, so
// a natively-loaded importer falls through to the real module.
rs.mock('../fixtures/nonLiteralDynamic/asyncDep.mjs', async () => ({
  value: 'MOCKED_ASYNC',
}));
// Throwing factory: the error must surface on the native path (fail the import)
// rather than silently fall through to the real module, matching the bundled path.
rs.mock('../fixtures/nonLiteralDynamic/throwingDep.mjs', () => {
  throw new Error('boom mock factory');
});
// Callable result: a factory whose exports ARE a function (a default-function /
// CommonJS-style module) must still be served natively as the default export,
// not rejected as "not an object".
rs.mock(
  '../fixtures/nonLiteralDynamic/callableDep.mjs',
  () => () => 'MOCKED_CALLABLE',
);
// ESM-shaped mock (`__esModule` true, no `default`): the native path must NOT
// synthesize a whole-object default, matching the bundled interop.
rs.mock('../fixtures/nonLiteralDynamic/esmShapedDep.mjs', () => ({
  __esModule: true,
  tag: 'MOCKED_ESM',
}));
// A legitimate function-valued `then` export must not be mistaken for an async
// (thenable) factory result and dropped.
rs.mock('../fixtures/nonLiteralDynamic/thenExportDep.mjs', () => ({
  then: () => 'MOCKED_THEN',
  value: 1,
}));

it('dynamic import with a string LITERAL applies the mock (control)', async () => {
  const mod = await import('../fixtures/nonLiteralDynamic/target.mts');
  expect(mod.probe()).toBe('MOCKED');
});

it('non-literal import where the variable IS a mocked builtin applies the mock (all Node)', async () => {
  // The specifier resolves to the mocked module itself — fixed by the request-key
  // bridge in the runtime router (no registerHooks needed), so this is ungated.
  const spec = ['node', 'os'].join(':');
  const os = (await import(spec)) as unknown as { hostname: () => string };
  expect(os.hostname()).toBe('MOCKED');
});

it('non-literal import of the other builtin spelling applies the mock (all Node)', async () => {
  // Mocked as `node:os`; imported via the bare `os` spelling. The request-key
  // bridge canonicalizes builtin spellings, so this matches without registerHooks.
  const id = ['o', 's'].join('');
  const os = (await import(id)) as unknown as { hostname: () => string };
  expect(os.hostname()).toBe('MOCKED');
});

it('a non-literal importActual of a mocked builtin returns the REAL module', async () => {
  // `importActual` carries the internal `with: { rstest }` attribute; the mock
  // router must NOT serve the mock for it, even when the specifier is non-literal
  // and names a mocked builtin. Without that gate, this returns 'MOCKED'.
  const id = ['node', 'os'].join(':');
  const real = (await import(id, {
    with: { rstest: 'importActual' },
  })) as unknown as { hostname: () => string };
  expect(real.hostname()).not.toBe('MOCKED');
  expect(typeof real.hostname()).toBe('string');
});

it('unmock clears both builtin spellings (mock node:, unmock bare) (all Node)', async () => {
  // The dynamic-import resolver treats `querystring` and `node:querystring` as
  // equivalent, so an unmock with either spelling must clear both — otherwise the
  // stale alias under the original key would still be served.
  rs.doMock('node:querystring', () => ({ escape: () => 'MOCKED_QS' }));
  const bare = ['query', 'string'].join('');
  const mocked = (await import(bare)) as unknown as { escape: () => string };
  expect(mocked.escape()).toBe('MOCKED_QS');

  // Unmock via the bare spelling although the mock was registered as `node:`.
  rs.doUnmock('querystring');
  const prefixed = ['node', 'querystring'].join(':');
  const real = (await import(prefixed)) as unknown as {
    escape: (s: string) => string;
  };
  expect(real.escape('a b')).toBe('a%20b');
});

describe.skipIf(!HAS_REGISTER_HOOKS)('non-literal specifier (#1454)', () => {
  it('dynamic import with a VARIABLE applies the mock (builtin)', async () => {
    const specifier = '../fixtures/nonLiteralDynamic/targetVar.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('MOCKED');
  });

  it('dynamic import of a module that imports a mocked npm package sees the mock', async () => {
    const specifier = '../fixtures/nonLiteralDynamic/targetVarNpm.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('MOCKED_STRIP');
  });

  it('a manual mock (__mocks__) applies to a natively loaded module', async () => {
    const specifier = '../fixtures/nonLiteralDynamic/targetVarManualMock.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('MOCKED_DNS');
  });

  it('a mocked class export stays constructible in a natively loaded module', async () => {
    const specifier = '../fixtures/nonLiteralDynamic/targetVarClass.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('MOCKED_CLASS');
  });

  it('evaluates a function-factory mock lazily — once, at native-import time', async () => {
    // Flushing the publish microtask must NOT run the factory: it runs only when
    // a natively-loaded module actually imports the mock (lazy producer), so a
    // factory with side effects keeps its lazy semantics.
    await Promise.resolve();
    await Promise.resolve();
    expect(fxCounter.__rstestFxCalls ?? 0).toBe(0);

    const specifier = '../fixtures/nonLiteralDynamic/targetVarSideEffect.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('MOCKED_FX');
    expect(fxCounter.__rstestFxCalls).toBe(1);
  });

  it('an async factory mock is not served natively — falls through to the real module', async () => {
    // The sync load hook can't produce async exports; the resolve hook must fall
    // through to the real module rather than serve an empty synthetic one.
    const specifier = '../fixtures/nonLiteralDynamic/targetVarAsyncFactory.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('REAL_ASYNC');
  });

  it('a throwing factory surfaces its error on the native path (not silent real)', async () => {
    // The factory throws when produced; the resolve hook must propagate that so
    // the import fails, rather than swallowing it and serving the real module.
    const specifier =
      '../fixtures/nonLiteralDynamic/targetVarThrowingFactory.mjs';
    await expect(import(specifier)).rejects.toThrow('boom mock factory');
  });

  it('a callable (default-function) mock is served natively', async () => {
    // The mock's exports are a bare function; it must be served as the default
    // export rather than rejected for not being a plain object.
    const specifier = '../fixtures/nonLiteralDynamic/targetVarCallable.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('MOCKED_CALLABLE');
  });

  it('an __esModule mock without a default synthesizes no default natively', async () => {
    // Named exports are served, but no whole-object default is invented — the
    // bundled interop only adds a default for non-__esModule shapes.
    const specifier = '../fixtures/nonLiteralDynamic/targetVarEsmShaped.mjs';
    const mod = (await import(specifier)) as {
      probe: () => string;
      hasDefault: () => boolean;
    };
    expect(mod.probe()).toBe('MOCKED_ESM');
    expect(mod.hasDefault()).toBe(false);
  });

  it('a mock exporting a function-valued `then` is served natively', async () => {
    // `{ then: fn }` is a valid export shape, not an async factory result, so it
    // must be served rather than dropped as thenable.
    const specifier = '../fixtures/nonLiteralDynamic/targetVarThenExport.mjs';
    const mod = (await import(specifier)) as { probe: () => string };
    expect(mod.probe()).toBe('MOCKED_THEN');
  });

  it('a CJS require of a mocked module is not redirected to the ESM synthetic', async () => {
    // `registerHooks` also fires for `require()`, but the synthetic mock module
    // is ESM. The resolve hook must leave require resolutions to Node, so the CJS
    // module receives the real `node:os` (not the mock, and not a load error).
    const specifier = '../fixtures/nonLiteralDynamic/cjsRequirer.cjs';
    const ns = (await import(specifier)) as {
      default?: { probe: () => string };
      probe?: () => string;
    };
    const probe = (ns.default ?? ns).probe!;
    expect(probe()).not.toBe('MOCKED');
  });
});
