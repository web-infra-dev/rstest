import { describe, expect, it } from '@rstest/core';
import {
  MIN_CORE_VERSION,
  shouldWarnCoreVersion,
} from '../../src/versionCheck';

describe('versionCheck', () => {
  it('should keep MIN_CORE_VERSION stable', () => {
    expect(MIN_CORE_VERSION).toBe('0.12.0');
  });

  it('should warn when core is lower than minimum', () => {
    // 0.11.0 has the `/api` subpath but only the old `runRstest`; `createRstest`
    // first ships in 0.12.0, so anything below it can't drive the worker.
    expect(shouldWarnCoreVersion('0.11.0')).toBe(true);
    expect(shouldWarnCoreVersion('0.10.6')).toBe(true);
    expect(shouldWarnCoreVersion('0.6.0')).toBe(true);
  });

  it('should not warn when core meets or exceeds minimum', () => {
    expect(shouldWarnCoreVersion('0.12.0')).toBe(false);
    expect(shouldWarnCoreVersion('0.12.1')).toBe(false);
    expect(shouldWarnCoreVersion('0.13.0')).toBe(false);
  });

  it('should handle prerelease versions', () => {
    expect(shouldWarnCoreVersion('0.12.0-beta.1')).toBe(true);
    expect(shouldWarnCoreVersion('0.12.1-beta.1')).toBe(false);
  });

  it('should ignore missing versions', () => {
    expect(shouldWarnCoreVersion()).toBe(false);
  });
});
