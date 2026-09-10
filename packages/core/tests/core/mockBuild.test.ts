import { describe, expect, it } from '@rstest/core';
import {
  applyJestMockApiAliases,
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
    });
  });

  it('maps Jest global module APIs without replacing user SWC globals', () => {
    const config = {
      jsc: {
        transform: {
          optimizer: {
            globals: {
              vars: {
                existing: 'true',
              },
            },
          },
        },
      },
    };

    applyJestMockApiAliases(config);

    expect(config.jsc.transform.optimizer.globals.vars).toEqual({
      existing: 'true',
      'jest.mock': 'rstest.mock',
      'jest.mockRequire': 'rstest.mockRequire',
      'jest.doMock': 'rstest.doMock',
      'jest.doMockRequire': 'rstest.doMockRequire',
      'jest.unmock': 'rstest.unmock',
      'jest.doUnmock': 'rstest.doUnmock',
      'jest.unmockRequire': 'rstest.unmockRequire',
      'jest.doUnmockRequire': 'rstest.doUnmockRequire',
      'jest.importMock': 'rstest.importMock',
      'jest.requireMock': 'rstest.requireMock',
      'jest.importActual': 'rstest.importActual',
      'jest.requireActual': 'rstest.requireActual',
      'jest.resetModules': 'rstest.resetModules',
      'jest.hoisted': 'rstest.hoisted',
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
});
