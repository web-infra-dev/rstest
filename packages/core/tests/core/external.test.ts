import type { Rspack } from '@rsbuild/core';
import { createAutoExternalNodeModules } from '../../src/core/plugins/external';

describe('createAutoExternalNodeModules', () => {
  it('keeps unresolved federation requests bundled', () => {
    const external = createAutoExternalNodeModules(false, true);
    const result: {
      error?: Error;
      value?: unknown;
      type?: unknown;
    } = {};

    // Test-only partial mock of Rspack's externals callback data.
    external(
      {
        context: '/root',
        request: 'remote/app',
        dependencyType: 'commonjs',
        getResolve: () => (_context, _request, callback) => {
          callback(new Error('not found'));
        },
      } as Rspack.ExternalItemFunctionData,
      (error, value, type) => {
        result.error = error;
        result.value = value;
        result.type = type;
      },
    );

    expect(result).toEqual({
      error: undefined,
      value: false,
      type: undefined,
    });
  });

  it('still externalizes unresolved non-federation requests', () => {
    const external = createAutoExternalNodeModules(false, false);
    const result: {
      error?: Error;
      value?: unknown;
      type?: unknown;
    } = {};

    // Test-only partial mock of Rspack's externals callback data.
    external(
      {
        context: '/root',
        request: 'remote/app',
        dependencyType: 'commonjs',
        getResolve: () => (_context, _request, callback) => {
          callback(new Error('not found'));
        },
      } as Rspack.ExternalItemFunctionData,
      (error, value, type) => {
        result.error = error;
        result.value = value;
        result.type = type;
      },
    );

    expect(result).toEqual({
      error: undefined,
      value: 'remote/app',
      type: 'node-commonjs',
    });
  });
});
