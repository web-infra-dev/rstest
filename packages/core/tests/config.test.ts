import { mergeRstestConfig, withDefaultConfig } from '../src/config';

describe('mergeRstestConfig', () => {
  it('should merge config correctly with default config', () => {
    const merged = withDefaultConfig({
      include: ['tests/**/*.test.ts'],
      root: __dirname,
      exclude: ['**/aa/**'],
      setupFiles: ['./setup.ts'],
      reporters: ['verbose'],
    });

    expect(merged).toMatchSnapshot();
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
