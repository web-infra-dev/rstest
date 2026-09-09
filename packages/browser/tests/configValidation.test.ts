import { describe, expect, it } from '@rstest/core';
import { browserIgnoredRuntimeConfigKeys } from '@rstest/core/internal/browser';
import { browserValidatedIgnoredKeys } from '../src/configValidation';

describe('browser config validation lockstep', () => {
  it('checks every browser-ignored RuntimeConfig key from the capability table', () => {
    // Anti-#1389: a new 'ignored-warn' / 'stripped' row in executorCapabilities
    // without a matching check in configValidation would be a silent browser
    // no-op. Importing configValidation also runs its module-load assertion.
    for (const key of browserIgnoredRuntimeConfigKeys) {
      expect(browserValidatedIgnoredKeys).toContain(key);
    }
  });
});
