import { mergeRstestConfig, withDefaultConfig } from '../src/config';
import type { RstestConfig } from '../src/types';

// Mock std-env to ensure consistent snapshot across environments
rs.mock('std-env', () => ({
  isCI: false,
}));

describe('mergeRstestConfig', () => {
  it('should merge config correctly with default config', () => {
    const merged = withDefaultConfig({
      include: ['tests/**/*.test.ts'],
      root: __dirname,
      exclude: ['**/aa/**'],
      setupFiles: ['./setup.ts'],
      globalSetup: ['./global-setup.ts'],
      reporters: ['verbose'],
    });

    expect(merged).toMatchSnapshot();
  });

  it('should handle globalSetup array conversion', () => {
    const merged = withDefaultConfig({
      globalSetup: './single-global-setup.ts',
    });

    expect(merged.globalSetup).toEqual(['./single-global-setup.ts']);
  });

  it('should merge exclude correctly', () => {
    expect(
      mergeRstestConfig(
        {
          exclude: ['**/node_modules/**'],
        },
        {
          exclude: {
            patterns: ['**/dist/**'],
            override: true,
          },
        },
      ),
    ).toEqual({
      exclude: {
        patterns: ['**/dist/**'],
      },
    });

    expect(
      mergeRstestConfig(
        {
          exclude: ['**/node_modules/**'],
        },
        {
          exclude: {
            patterns: ['**/dist/**'],
            override: false,
          },
        },
      ),
    ).toEqual({
      exclude: {
        patterns: ['**/node_modules/**', '**/dist/**'],
        override: false,
      },
    });

    expect(
      mergeRstestConfig(
        {
          exclude: {
            patterns: ['**/dist/**'],
            override: false,
          },
        },
        {
          exclude: ['**/node_modules/**'],
        },
        {
          exclude: {
            patterns: ['**/aa/**'],
            override: true,
          },
        },
      ),
    ).toEqual({
      exclude: {
        patterns: ['**/aa/**'],
      },
    });
  });
});

describe('withDefaultConfig browser normalization', () => {
  it('should not throw when browser.enabled is true and provider is missing', () => {
    const config = {
      browser: { enabled: true },
    } as RstestConfig;

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should preserve custom provider value for browser loader validation', () => {
    const config = {
      browser: { enabled: true, provider: 'invalid' },
    } as unknown as RstestConfig;

    const normalized = withDefaultConfig(config);
    expect(normalized.browser.provider).toBe('invalid');
  });

  it('should not throw when browser.enabled is true and provider is playwright', () => {
    const config: RstestConfig = {
      browser: { enabled: true, provider: 'playwright' },
    };

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should preserve viewport value for browser loader validation', () => {
    const config = {
      browser: {
        enabled: true,
        provider: 'playwright',
        viewport: 'iPhone99',
      },
    } as unknown as RstestConfig;

    const normalized = withDefaultConfig(config);
    expect(normalized.browser.viewport).toBe('iPhone99');
  });

  it('should not throw when browser.viewport preset id is valid', () => {
    const config: RstestConfig = {
      browser: {
        enabled: true,
        provider: 'playwright',
        viewport: 'iPhone12Pro',
      },
    };

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should not throw when browser.enabled is false without provider', () => {
    const config = {
      browser: { enabled: false },
    } as RstestConfig;

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should not throw when browser is empty object', () => {
    const config = {
      browser: {},
    } as RstestConfig;

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should not throw when browser is not specified', () => {
    const config: RstestConfig = {};

    expect(() => withDefaultConfig(config)).not.toThrow();
  });
});
