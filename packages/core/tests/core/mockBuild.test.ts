import { describe, expect, it } from '@rstest/core';
import {
  getMockRstestPluginOptions,
  injectChunkInstallMockGuard,
} from '../../src/core/plugins/mockBuild';

describe('mock build parameterization', () => {
  it('produces the target-agnostic RstestPlugin option base', () => {
    expect(getMockRstestPluginOptions({ rootPath: '/repo/project' })).toEqual({
      injectModulePathName: true,
      injectImportMetaRstestOrigin: true,
      importMetaPathName: true,
      hoistMockModule: true,
      manualMockRoot: '/repo/project/__mocks__',
      updateImportMockAPI: true,
      updateRequireMockAPI: true,
    });
  });
});

describe('injectChunkInstallMockGuard', () => {
  // Representative shape of rspack's jsonp chunk-install runtime; if a future
  // rspack changes the loop text, this test goes stale together with the
  // guard, surfacing the silent no-match failure mode.
  const chunkInstallRuntime = [
    'var installChunk = function (data) {',
    '  var moduleId, chunkId, i = 0;',
    '  for (var moduleId in moreModules) {',
    '    if (__webpack_require__.o(moreModules, moduleId)) {',
    '      __webpack_require__.m[moduleId] = moreModules[moduleId];',
    '    }',
    '  }',
    '};',
  ].join('\n');

  it('injects the mocked-id guard right after the chunk-install loop header', () => {
    const patched = injectChunkInstallMockGuard(chunkInstallRuntime);
    expect(patched).not.toBe(chunkInstallRuntime);
    const lines = patched.split('\n');
    const loopIndex = lines.indexOf('  for (var moduleId in moreModules) {');
    expect(loopIndex).toBeGreaterThan(-1);
    expect(lines[loopIndex + 1]).toContain(
      '__webpack_require__.rstest_original_modules',
    );
    expect(lines[loopIndex + 1]).toContain('continue;');
  });

  it('also matches the assignment-form loop header', () => {
    const source = 'for (moduleId in moreModules) {\n}';
    expect(injectChunkInstallMockGuard(source)).toContain(
      'rstest_original_module_factories',
    );
  });

  it('leaves runtime modules without a chunk-install loop untouched', () => {
    const source = '__webpack_require__.f = {};';
    expect(injectChunkInstallMockGuard(source)).toBe(source);
  });

  it.each(['rstest_original_modules', 'rstest_original_module_factories'])(
    'preserves mocked factories registered in %s',
    (registryName) => {
      const mockedFactory = () => 'mocked';
      const realFactory = () => 'real';
      const modules = { mocked: mockedFactory };
      const webpackRequire = {
        m: modules,
        o: Object.hasOwn,
        [registryName]: Object.assign(Object.create({ inherited: true }), {
          mocked: undefined,
        }),
      };

      const installChunk = new Function(
        '__webpack_require__',
        'moreModules',
        `${injectChunkInstallMockGuard(chunkInstallRuntime)}\ninstallChunk();`,
      );
      installChunk(webpackRequire, {
        mocked: realFactory,
        ordinary: realFactory,
        inherited: realFactory,
        hasOwnProperty: realFactory,
      });

      expect(modules).toEqual({
        mocked: mockedFactory,
        ordinary: realFactory,
        inherited: realFactory,
        hasOwnProperty: realFactory,
      });
    },
  );

  it('installs chunks before the mock registries are initialized', () => {
    const realFactory = () => 'real';
    const modules = {};
    const installChunk = new Function(
      '__webpack_require__',
      'moreModules',
      `${injectChunkInstallMockGuard(chunkInstallRuntime)}\ninstallChunk();`,
    );
    installChunk({ m: modules, o: Object.hasOwn }, { ordinary: realFactory });

    expect(modules).toEqual({ ordinary: realFactory });
  });
});
