import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import type { RuntimeDependencyRequest } from '../../src/core/execution/runtimeDependencies';

const workerPath = resolve(
  __dirname,
  '../../src/core/execution/runtimeDependenciesWorker.mjs',
);
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rstest-native-dependencies-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, source: string): string {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

function analyze(
  source: string,
  sources = [join(root, 'native/helper.cjs')],
  execArgv: string[] = [],
) {
  write('native/provider.cjs', source);
  write('native/helper.cjs', 'module.exports = 42;');
  write('native/provider.js', 'module.exports = 0;');
  const consumer = join(root, 'example.test.mjs');
  const requests: RuntimeDependencyRequest[] = [
    {
      consumer,
      source: consumer,
      call: {
        kind: 'require',
        origin: 'entry',
        parts: ['./native/provider.cjs'],
      },
    },
  ];
  const child = spawnSync(
    process.execPath,
    ['--experimental-import-meta-resolve', ...execArgv, workerPath],
    {
      input: JSON.stringify({ requests, sources }),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.stderr).toBe('');
  expect(child.status).toBe(0);
  const result: { consumers: string[]; unresolved: string[] } = JSON.parse(
    child.stdout,
  );
  return result;
}

describe('native dependency worker', () => {
  it('keeps the CommonJS wrapper require after an uninitialized var redeclaration', () => {
    const source = 'var require; module.exports = require("./helper.cjs");';
    expect(analyze(source)).toMatchObject({
      consumers: [join(root, 'example.test.mjs')],
      unresolved: [],
    });
    expect(analyze(source, [join(root, 'unrelated.cjs')])).toMatchObject({
      consumers: [],
      unresolved: [],
    });
  });

  it('keeps literal resolution separate from loading the target', () => {
    const invalidTarget = write('native/invalid.cjs', 'this is not JavaScript');
    expect(
      analyze('module.exports = require.resolve("./invalid.cjs");', [
        invalidTarget,
      ]),
    ).toMatchObject({
      consumers: [join(root, 'example.test.mjs')],
      unresolved: [],
    });
    expect(
      analyze('module.exports = require.resolve("./invalid.cjs");'),
    ).toMatchObject({ consumers: [], unresolved: [] });
    expect(
      analyze('module.exports = require.resolve("node:module");'),
    ).toMatchObject({ consumers: [], unresolved: [] });
  });

  it('respects function-local require bindings', () => {
    expect(
      analyze(
        'module.exports = function (require) { return require("./helper.cjs"); };',
      ),
    ).toMatchObject({ consumers: [], unresolved: [] });
  });

  it.each([
    ['wrapper reassignment', 'var require = globalThis.load;'],
    ['loop assignment', 'for (var require of []) {}'],
    [
      'resolve extraction',
      'const resolve = require.resolve; module.exports = resolve("./helper.cjs");',
    ],
    [
      'indirect resolve call',
      'module.exports = require.resolve.call(null, "./helper.cjs");',
    ],
    [
      'created require alias',
      'const { createRequire: makeRequire } = require("node:module"); const load = makeRequire(__filename); module.exports = load("./helper.cjs");',
    ],
    [
      'loading hook alias',
      'const { registerHooks: hooks } = require("module"); hooks({});',
    ],
    [
      'loader extension replacement',
      `require.extensions[".js"] = (module, filename) => module._compile('module.exports = require("./helper.cjs")', filename); module.exports = require("./provider.js");`,
    ],
  ])(
    'rejects %s instead of reporting an empty complete selection',
    (_, source) => {
      const result = analyze(source);
      expect(result.consumers).toEqual([]);
      expect(result.unresolved.length).toBeGreaterThan(0);
    },
  );

  it.each([
    'var require = () => 42; module.exports = require("./helper.cjs");',
    'module.exports = require("./helper.cjs"); require.extensions[".js"] = () => {};',
    'module.exports = require("./helper.cjs"); require("./opaque.cjs");',
  ])(
    'rejects unsupported native loading even after a textual path matches: %s',
    (source) => {
      write(
        'native/opaque.cjs',
        'const { createRequire: load } = require("node:module");',
      );
      const result = analyze(source);
      expect(result.consumers).toEqual([]);
      expect(result.unresolved.length).toBeGreaterThan(0);
    },
  );

  it.each(['require', 'import'])(
    'matches deleted %s targets through existing and dangling symlinks',
    (kind) => {
      const extension = kind === 'require' ? 'cjs' : 'mjs';
      const helper = write(
        `shared/nested/helper.${extension}`,
        kind === 'require' ? 'module.exports = 42;' : 'export default 42;',
      );
      symlinkSync(join(root, 'shared'), join(root, 'linked'), 'junction');
      const source = `module.exports = ${kind}("../linked/nested/helper.${extension}");`;
      const expected = {
        consumers: [join(root, 'example.test.mjs')],
        unresolved: [],
      };
      expect(analyze(source, [helper])).toMatchObject(expected);
      expect(
        analyze(source, [join(root, 'shared/unrelated.cjs')]),
      ).toMatchObject({
        consumers: [],
        unresolved: [],
      });

      rmSync(helper);
      expect(analyze(source, [helper])).toMatchObject(expected);
      expect(
        analyze(source, [join(root, 'linked/nested', basename(helper))]),
      ).toMatchObject(expected);
      expect(
        analyze(source, [join(root, 'shared/unrelated.cjs')]),
      ).toMatchObject({
        consumers: [],
        unresolved: [],
      });
      rmSync(dirname(helper), { recursive: true });
      expect(analyze(source, [helper])).toMatchObject(expected);
      expect(
        analyze(source, [join(root, 'linked/nested', basename(helper))]),
      ).toMatchObject(expected);
      expect(
        analyze(source, [join(root, 'shared/nested/unrelated.cjs')]),
      ).toMatchObject({ consumers: [], unresolved: [] });
      rmSync(join(root, 'shared'), { recursive: true });
      expect(analyze(source, [helper])).toMatchObject(expected);
      expect(
        analyze(source, [join(root, 'linked/nested', basename(helper))]),
      ).toMatchObject(expected);
      expect(
        analyze(source, [join(root, 'shared/nested/unrelated.cjs')]),
      ).toMatchObject({ consumers: [], unresolved: [] });

      const fileLink = join(root, `file-link.${extension}`);
      symlinkSync(helper, fileLink, 'file');
      const fileSource = `module.exports = ${kind}("../file-link.${extension}");`;
      expect(analyze(fileSource, [helper])).toMatchObject(expected);
      expect(analyze(fileSource, [fileLink])).toMatchObject(expected);
      expect(
        analyze(fileSource, [join(root, 'shared/nested/unrelated.cjs')]),
      ).toMatchObject({ consumers: [], unresolved: [] });
    },
  );

  it('reports cyclic symlink resolution as incomplete', () => {
    const link = join(root, 'cyclic');
    symlinkSync(link, link, 'junction');
    const result = analyze('module.exports = require("../cyclic/helper.cjs");');
    expect(result.consumers).toEqual([]);
    expect(result.unresolved.length).toBeGreaterThan(0);
  });

  it('keeps both native module origins when Node preserves symlinks', () => {
    const shared = write(
      'shared/provider.cjs',
      'module.exports = require("../helper.cjs");',
    );
    const firstHelper = write('first/helper.cjs', 'module.exports = 1;');
    const secondHelper = write('second/helper.cjs', 'module.exports = 2;');
    for (const directory of ['first', 'second']) {
      symlinkSync(dirname(shared), join(root, directory, 'linked'), 'junction');
    }
    const source =
      'module.exports = [require("../first/linked/provider.cjs"), require("../second/linked/provider.cjs")];';
    for (const helper of [firstHelper, secondHelper]) {
      expect(analyze(source, [helper], ['--preserve-symlinks'])).toMatchObject({
        consumers: [join(root, 'example.test.mjs')],
        unresolved: [],
      });
    }
    expect(
      analyze(source, [join(root, 'unrelated.cjs')], ['--preserve-symlinks']),
    ).toMatchObject({ consumers: [], unresolved: [] });
    const runtime = spawnSync(
      process.execPath,
      [
        '--preserve-symlinks',
        '-e',
        'process.stdout.write(JSON.stringify(require(process.argv[1])));',
        join(root, 'native/provider.cjs'),
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(runtime.status).toBe(0);
    expect(runtime.stdout).toBe('[1,2]');
  });
});
