import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'pathe';
import {
  clearModuleCache as clearEsModuleCache,
  loadModule as loadEsModule,
} from '../../src/runtime/worker/loadEsModule';
import {
  clearModuleCache as clearCjsModuleCache,
  loadModule,
} from '../../src/runtime/worker/loadModule';
import {
  importMetaHook,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from '../../src/runtime/worker/runtimeHooks';

describe('require.resolve origin runtime helper', () => {
  afterEach(() => {
    clearEsModuleCache();
    clearCjsModuleCache();
  });

  it('resolves relative specifiers against injected source module origin', () => {
    const dir = path.join(os.tmpdir(), `rstest-require-resolve-${Date.now()}`);
    const depDir = path.join(dir, 'dist');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(path.join(depDir, 'exportHelper.js'), 'module.exports = {}');

    const testPath = path.join(dir, 'test', 'template.spec.ts');
    const origin = path.join(depDir, 'index.js');
    const exports = loadModule({
      codeContent: `module.exports = ${RSTEST_REQUIRE_RESOLVE_HOOK}('./exportHelper', ${JSON.stringify(origin)});`,
      distPath: path.join(dir, 'bundle.js'),
      testPath,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(exports).toBe(realpathSync(path.join(depDir, 'exportHelper.js')));
  });

  it('preserves require.resolve options when origin is injected', () => {
    const dir = path.join(
      os.tmpdir(),
      `rstest-require-resolve-options-${Date.now()}`,
    );
    const targetDir = path.join(dir, 'custom-path');
    const packageDir = path.join(targetDir, 'node_modules', 'foo');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ main: 'index.js' }),
    );
    writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {}');

    const origin = path.join(dir, 'src', 'index.js');
    const exports = loadModule({
      codeContent: `module.exports = ${RSTEST_REQUIRE_RESOLVE_HOOK}('foo', { paths: [${JSON.stringify(targetDir)}] }, ${JSON.stringify(origin)});`,
      distPath: path.join(dir, 'bundle.js'),
      testPath: path.join(dir, 'test.spec.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(exports).toBe(realpathSync(path.join(packageDir, 'index.js')));
  });

  it('preserves require.resolve.paths on the shimmed require', () => {
    const dir = path.join(
      os.tmpdir(),
      `rstest-require-resolve-paths-${Date.now()}`,
    );
    mkdirSync(dir, { recursive: true });

    const testPath = path.join(dir, 'test.spec.ts');
    const exports = loadModule({
      codeContent: `module.exports = require.resolve.paths('foo');`,
      distPath: path.join(dir, 'bundle.js'),
      testPath,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(exports).toEqual(createRequire(testPath).resolve.paths('foo'));
  });

  it('attaches the helper to import.meta in esm mode', async () => {
    const dir = path.join(
      os.tmpdir(),
      `rstest-require-resolve-esm-${Date.now()}`,
    );
    const depDir = path.join(dir, 'dist');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(path.join(depDir, 'exportHelper.js'), 'module.exports = {}');

    const origin = path.join(depDir, 'index.mjs');
    const mod = await loadEsModule({
      codeContent: `export default ${importMetaHook(RSTEST_REQUIRE_RESOLVE_HOOK)}('./exportHelper', ${JSON.stringify(origin)});`,
      distPath: path.join(dir, 'bundle.mjs'),
      testPath: path.join(dir, 'test.spec.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(mod.default).toBe(
      realpathSync(path.join(depDir, 'exportHelper.js')),
    );
  });
});
