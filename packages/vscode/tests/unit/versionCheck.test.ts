import { describe, expect, it } from '@rstest/core';
import {
  formatConfiguredCoreVersionWarningMessage,
  formatUnsupportedCoreVersionMessage,
  isUnsupportedCoreVersion,
  MIN_CORE_VERSION,
} from '../../src/versionCheck';

describe('versionCheck', () => {
  it('should keep MIN_CORE_VERSION stable', () => {
    expect(MIN_CORE_VERSION).toBe('0.12.0');
  });

  it('should reject core versions below the minimum', () => {
    expect(isUnsupportedCoreVersion('0.11.9')).toBe(true);
  });

  it('should accept core versions that meet or exceed the minimum', () => {
    expect(isUnsupportedCoreVersion('0.12.0')).toBe(false);
    expect(isUnsupportedCoreVersion('0.12.1')).toBe(false);
    expect(isUnsupportedCoreVersion('1.0.0')).toBe(false);
  });

  it('should handle prerelease versions', () => {
    expect(isUnsupportedCoreVersion('0.12.0-beta.1')).toBe(true);
    expect(isUnsupportedCoreVersion('0.12.1-beta.1')).toBe(false);
  });

  it('should ignore missing versions', () => {
    expect(isUnsupportedCoreVersion()).toBe(false);
  });

  it('should explain both supported migration paths', () => {
    const message = formatUnsupportedCoreVersionMessage('0.11.9');
    expect(message).toContain('@rstest/core >= 0.12.0');
    expect(message).toContain('Upgrade @rstest/core to >= 0.12.0');
    expect(message).toContain(
      'install an older version of the Rstest extension in VS Code',
    );
  });

  it('should distinguish the explicit package path override', () => {
    const message = formatConfiguredCoreVersionWarningMessage('0.11.9');
    expect(message).toContain('rstest.rstestPackagePath');
    expect(message).toContain('developer override');
    expect(message).toContain('compatibility is not guaranteed');
  });
});
