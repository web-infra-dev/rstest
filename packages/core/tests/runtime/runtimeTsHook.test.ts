import {
  isRuntimeTsHookSupportedVersion,
  looksLikeCjs,
  looksLikeEsm,
} from '../../src/runtime/worker/runtimeTsHook';

describe('looksLikeCjs / looksLikeEsm', () => {
  it('detects CJS-only sources', () => {
    const sources = [
      "module.exports = { name: 'plugin' };",
      "exports.foo = 'bar';",
      "exports['foo'] = 'bar';",
      "const dep = require('./dep');",
    ];
    for (const source of sources) {
      expect(looksLikeCjs(source)).toBe(true);
      expect(looksLikeEsm(source)).toBe(false);
    }
  });

  it('detects ESM-only sources', () => {
    const sources = [
      "import x from './x';",
      "import './side-effect';",
      "import { a } from './a';",
      "import * as ns from './ns';",
      'export const a = 1;',
      "export { a } from './a';",
      "export * from './a';",
    ];
    for (const source of sources) {
      expect(looksLikeEsm(source)).toBe(true);
      expect(looksLikeCjs(source)).toBe(false);
    }
  });

  it('does not treat dynamic import() in a CJS file as ESM', () => {
    // `import(` is legal in CommonJS — it must not flip the file to ESM.
    const source = [
      "const dep = require('./dep');",
      "module.exports = async () => (await import('./lazy.js')).default;",
    ].join('\n');
    expect(looksLikeEsm(source)).toBe(false);
    expect(looksLikeCjs(source)).toBe(true);
  });

  it('does not treat import.meta as ESM syntax', () => {
    // `import.meta` alone is not an import declaration; the CJS markers win.
    const source = [
      'const here = import.meta.url;',
      'module.exports = { here };',
    ].join('\n');
    expect(looksLikeEsm(source)).toBe(false);
    expect(looksLikeCjs(source)).toBe(true);
  });

  it('ignores import declarations inside line comments', () => {
    const source = [
      "// import x from './x';",
      '  // export const a = 1;',
      "module.exports = { name: 'plugin' };",
    ].join('\n');
    expect(looksLikeCjs(source)).toBe(true);
    expect(looksLikeEsm(source)).toBe(false);
  });

  it('ignores import declarations inside block comments', () => {
    const source = [
      '/*',
      " import x from './x';",
      ' export const a = 1;',
      '*/',
      "module.exports = { name: 'plugin' };",
    ].join('\n');
    expect(looksLikeCjs(source)).toBe(true);
    expect(looksLikeEsm(source)).toBe(false);
  });

  it('ignores CJS markers inside comments when sniffing ESM', () => {
    const source = [
      "// module.exports = {}; require('./legacy');",
      '/* exports.foo = 1; */',
      "import x from './x';",
      'export const a = x;',
    ].join('\n');
    expect(looksLikeEsm(source)).toBe(true);
    expect(looksLikeCjs(source)).toBe(false);
  });

  it('reports neither for empty or ambiguous sources', () => {
    const sources = [
      '',
      '\n\n  \n',
      '// just a comment',
      'const a: number = 1;',
      'export',
      'type Foo = { a: string };',
    ];
    for (const source of sources) {
      expect(looksLikeCjs(source)).toBe(false);
      expect(looksLikeEsm(source)).toBe(false);
    }
  });

  it('reports neither for mixed sources (both marker families present)', () => {
    // Ambiguous: transforming either way could change working semantics, so the
    // hook must leave it to Node.
    const source = ["import x from './x';", 'module.exports = x;'].join('\n');
    expect(looksLikeCjs(source)).toBe(false);
    expect(looksLikeEsm(source)).toBe(false);
  });
});

describe('isRuntimeTsHookSupportedVersion', () => {
  const version = (spec: string) => {
    const [major = 0, minor = 0, patch = 0] = spec.split('.').map(Number);
    return { major, minor, patch };
  };

  // The gate mirrors nodejs/node#59929 (sync-hook CJS reentrancy fix), shipped
  // in v22.22.3, v24.11.1, v25.1.0 and v26.0.0.
  it.each([
    // major 22 → >= 22.22.3
    ['22.21.9', false],
    ['22.22.0', false],
    ['22.22.2', false],
    ['22.22.3', true],
    ['22.22.4', true],
    ['22.23.0', true],
    // major 24 → >= 24.11.1
    ['24.10.9', false],
    ['24.11.0', false],
    ['24.11.1', true],
    ['24.12.0', true],
    // major 25 → >= 25.1.0
    ['25.0.9', false],
    ['25.1.0', true],
    ['25.2.0', true],
    // major >= 26 → always
    ['26.0.0', true],
    ['27.5.1', true],
    // unsupported majors, however high the minor/patch
    ['20.19.0', false],
    ['20.99.99', false],
    ['21.7.3', false],
    ['23.11.1', false],
    ['23.99.99', false],
  ] as const)('%s → %s', (spec, expected) => {
    expect(isRuntimeTsHookSupportedVersion(version(spec))).toBe(expected);
  });

  it('closes the gate on unparsable versions', () => {
    // Pre-release tags (e.g. `23.0.0-nightly`) yield NaN; every comparison
    // against NaN is false, which is the desired failure mode.
    expect(isRuntimeTsHookSupportedVersion(version('22.22.x'))).toBe(false);
    expect(
      isRuntimeTsHookSupportedVersion({ major: 0, minor: 0, patch: 0 }),
    ).toBe(false);
  });
});
