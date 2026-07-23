import { describe, expect, it } from '@rstest/core';
import {
  formatCoreNotFoundMessage,
  isModuleNotFoundError,
} from '../../src/coreResolution';

describe('isModuleNotFoundError', () => {
  // The extension detects the failure Node actually throws, so resolve a
  // missing package for real rather than hand-building an error object.
  it('should detect a real resolution failure', () => {
    let error: unknown;
    try {
      require.resolve('@rstest/definitely-not-installed', {
        paths: [__dirname],
      });
    } catch (e) {
      error = e;
    }
    expect(isModuleNotFoundError(error)).toBe(true);
  });

  it('should ignore other errors', () => {
    expect(isModuleNotFoundError(new Error('boom'))).toBe(false);
    expect(isModuleNotFoundError('MODULE_NOT_FOUND')).toBe(false);
    expect(isModuleNotFoundError(undefined)).toBe(false);
  });
});

describe('formatCoreNotFoundMessage', () => {
  it('should point at the configured package path instead of the install hint', () => {
    const message = formatCoreNotFoundMessage({
      searchedFrom: '/repo/app',
      configuredPackagePath: '/repo/vendor/core/package.json',
    });
    expect(message).toContain('/repo/vendor/core/package.json');
    expect(message).not.toContain('Install the project dependencies');
  });
});
