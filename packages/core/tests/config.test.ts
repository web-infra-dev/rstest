import { mergeRstestConfig, withDefaultConfig } from '../src/config';

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
