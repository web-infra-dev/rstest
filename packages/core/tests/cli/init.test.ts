import { describe, expect, it } from '@rstest/core';
import { join } from 'pathe';
import { mergeWithCLIOptions, resolveProjects } from '../../src/cli/init';
import type { RstestConfig } from '../../src/types';

const rootPath = join(__dirname, '../..');

describe('mergeWithCLIOptions', () => {
  it('creates simple nested build config objects from CLI', () => {
    const config = mergeWithCLIOptions(
      {},
      {
        source: {
          tsconfigPath: 'tsconfig.cli.json',
        },
        dev: {
          writeToDisk: true,
        },
        output: {
          emitAssets: false,
          cleanDistPath: true,
          module: false,
        },
      },
    );

    expect(config).toEqual({
      source: {
        tsconfigPath: 'tsconfig.cli.json',
      },
      dev: {
        writeToDisk: true,
      },
      output: {
        emitAssets: false,
        cleanDistPath: true,
        module: false,
      },
    });
  });

  it('preserves nested build config fields that are not supported by CLI', () => {
    const config = mergeWithCLIOptions(
      {
        source: {
          define: {
            BASE_URL: JSON.stringify('https://example.com'),
          },
        },
        output: {
          cssModules: {
            localIdentName: '[local]-[hash:base64:6]',
          },
          externals: ['react'],
        },
      },
      {
        source: {
          tsconfigPath: 'tsconfig.cli.json',
        },
        output: {
          emitAssets: false,
        },
      },
    );

    expect(config).toMatchObject({
      source: {
        define: {
          BASE_URL: JSON.stringify('https://example.com'),
        },
        tsconfigPath: 'tsconfig.cli.json',
      },
      output: {
        cssModules: {
          localIdentName: '[local]-[hash:base64:6]',
        },
        externals: ['react'],
        emitAssets: false,
      },
    });
  });

  it('merges simple nested build options from CLI', () => {
    const config = mergeWithCLIOptions(
      {
        includeTaskLocation: false,
        source: {
          tsconfigPath: 'base.tsconfig.json',
        },
        dev: {
          writeToDisk: false,
        },
        output: {
          emitAssets: true,
          cleanDistPath: true,
          module: true,
        },
      },
      {
        includeTaskLocation: true,
        source: {
          tsconfigPath: 'cli.tsconfig.json',
        },
        dev: {
          writeToDisk: true,
        },
        output: {
          emitAssets: false,
          cleanDistPath: false,
          module: false,
        },
      },
    );

    expect(config).toMatchObject({
      includeTaskLocation: true,
      source: {
        tsconfigPath: 'cli.tsconfig.json',
      },
      dev: {
        writeToDisk: true,
      },
      output: {
        emitAssets: false,
        cleanDistPath: false,
        module: false,
      },
    });
  });
});

describe('resolveProjects', () => {
  describe('inline project extends', () => {
    it('should handle inline project with extends as object', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            extends: {
              testEnvironment: 'jsdom',
              globals: true,
              include: ['**/*.test.ts'],
            },
            testTimeout: 10000,
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.name).toBe('test-project');
      expect(projects[0]!.config.testEnvironment).toBe('jsdom');
      expect(projects[0]!.config.globals).toBe(true);
      expect(projects[0]!.config.include).toEqual(['**/*.test.ts']);
      expect(projects[0]!.config.testTimeout).toBe(10000);
    });

    it('should handle inline project with extends as async function', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            extends: async (userConfig) => {
              // Verify userConfig is passed correctly
              expect(userConfig.testTimeout).toBe(10000);
              return {
                testEnvironment: 'jsdom',
                globals: true,
              };
            },
            testTimeout: 10000,
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.testEnvironment).toBe('jsdom');
      expect(projects[0]!.config.globals).toBe(true);
      expect(projects[0]!.config.testTimeout).toBe(10000);
    });

    it('should override extends config with local project config', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            extends: {
              testEnvironment: 'jsdom',
              testTimeout: 5000,
              globals: true,
            },
            testTimeout: 10000, // Should override extends
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.testEnvironment).toBe('jsdom');
      expect(projects[0]!.config.testTimeout).toBe(10000); // Overridden by local config
      expect(projects[0]!.config.globals).toBe(true);
    });

    it('should filter out projects field from extends', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            extends: {
              testEnvironment: 'jsdom',
              projects: ['some-nested-project'], // Should be filtered out
            } as RstestConfig,
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.testEnvironment).toBe('jsdom');
      expect(projects[0]!.config.projects).toBeUndefined();
    });

    it('should handle multiple inline projects with extends', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'project-a',
            extends: {
              testEnvironment: 'jsdom',
            },
            testTimeout: 5000,
          },
          {
            name: 'project-b',
            extends: {
              testEnvironment: 'node',
            },
            testTimeout: 10000,
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(2);

      const projectA = projects.find((p) => p.config.name === 'project-a');
      const projectB = projects.find((p) => p.config.name === 'project-b');

      expect(projectA!.config.testEnvironment).toBe('jsdom');
      expect(projectA!.config.testTimeout).toBe(5000);

      expect(projectB!.config.testEnvironment).toBe('node');
      expect(projectB!.config.testTimeout).toBe(10000);
    });

    it('should handle inline project with extends function receiving frozen config', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            testTimeout: 10000,
            extends: (userConfig) => {
              // Verify userConfig is frozen
              expect(Object.isFrozen(userConfig)).toBe(true);

              // Attempting to modify should throw in strict mode
              expect(() => {
                (userConfig as any).testTimeout = 20000;
              }).toThrow();

              return {
                testEnvironment: 'jsdom',
              };
            },
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.testEnvironment).toBe('jsdom');
      expect(projects[0]!.config.testTimeout).toBe(10000); // Original value unchanged
    });

    it('should handle inline project without extends', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            testTimeout: 10000,
            testEnvironment: 'node',
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.name).toBe('test-project');
      expect(projects[0]!.config.testTimeout).toBe(10000);
      expect(projects[0]!.config.testEnvironment).toBe('node');
    });

    it('should apply CLI options after extends merge', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            extends: {
              testTimeout: 5000,
            },
            testTimeout: 10000,
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {
          testTimeout: 15000, // CLI option should take precedence
        },
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.testTimeout).toBe(15000);
    });

    it('should handle inline project with extends as array', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            extends: [
              {
                testEnvironment: 'jsdom',
                setupFiles: ['./setup-a.ts'],
                source: {
                  define: {
                    BASE_URL: '"https://example.com"',
                  },
                },
              },
              {
                globals: true,
                setupFiles: ['./setup-b.ts'],
                source: {
                  define: {
                    API_URL: '"https://api.example.com"',
                  },
                },
              },
            ],
            testTimeout: 10000,
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.testEnvironment).toBe('jsdom');
      expect(projects[0]!.config.globals).toBe(true);
      expect(projects[0]!.config.testTimeout).toBe(10000);
      expect(projects[0]!.config.setupFiles).toEqual([
        './setup-a.ts',
        './setup-b.ts',
      ]);
      expect(projects[0]!.config.source).toEqual({
        define: {
          BASE_URL: '"https://example.com"',
          API_URL: '"https://api.example.com"',
        },
      });
    });

    it('should pass the original project config to every extends function in arrays', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            testTimeout: 10000,
            retry: 2,
            extends: [
              (userConfig) => {
                expect(Object.isFrozen(userConfig)).toBe(true);
                expect(userConfig.testTimeout).toBe(10000);
                expect(userConfig.retry).toBe(2);
                expect(userConfig.testEnvironment).toBeUndefined();

                return {
                  testEnvironment: 'jsdom',
                };
              },
              (userConfig) => {
                expect(Object.isFrozen(userConfig)).toBe(true);
                expect(userConfig.testTimeout).toBe(10000);
                expect(userConfig.retry).toBe(2);
                expect(userConfig.testEnvironment).toBeUndefined();

                return {
                  globals: true,
                };
              },
            ],
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {},
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]!.config.testEnvironment).toBe('jsdom');
      expect(projects[0]!.config.globals).toBe(true);
      expect(projects[0]!.config.testTimeout).toBe(10000);
      expect(projects[0]!.config.retry).toBe(2);
    });
  });

  describe('browser CLI options', () => {
    it('should apply --browser shorthand (boolean)', async () => {
      const config: RstestConfig = {
        projects: [{ name: 'test-project' }],
      };

      // --browser sets browser to true, --no-browser sets to false
      const enabledProjects = await resolveProjects({
        config,
        root: rootPath,
        options: { browser: true },
      });
      expect(enabledProjects[0]!.config.browser?.enabled).toBe(true);

      const disabledProjects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
              browser: { enabled: true, provider: 'playwright' },
            },
          ],
        },
        root: rootPath,
        options: { browser: false },
      });
      expect(disabledProjects[0]!.config.browser?.enabled).toBe(false);
    });

    it('should apply all browser.* options from CLI', async () => {
      const config: RstestConfig = {
        projects: [{ name: 'test-project' }],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {
          browser: {
            enabled: true,
            name: 'webkit',
            headless: false,
            port: 4000,
            strictPort: true,
          },
        },
      });

      expect(projects[0]!.config.browser).toEqual({
        enabled: true,
        provider: 'playwright',
        browser: 'webkit',
        headless: false,
        port: 4000,
        strictPort: true,
      });
    });

    it('should override config browser options with CLI options', async () => {
      const config: RstestConfig = {
        projects: [
          {
            name: 'test-project',
            browser: {
              enabled: true,
              provider: 'playwright',
              browser: 'chromium',
              headless: true,
              port: 5000,
            },
          },
        ],
      };

      const projects = await resolveProjects({
        config,
        root: rootPath,
        options: {
          browser: { name: 'firefox', port: 6000 },
        },
      });

      expect(projects[0]!.config.browser).toMatchObject({
        enabled: true, // preserved from config
        browser: 'firefox', // overridden by CLI
        headless: true, // preserved from config
        port: 6000, // overridden by CLI
      });
    });
  });

  describe('coverage CLI options', () => {
    it('should apply coverage.changed from CLI', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
              coverage: {
                enabled: true,
              },
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            changed: 'HEAD',
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        changed: 'HEAD',
      });
    });

    it('should normalize boolean-like coverage CLI values', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            enabled: 'true',
            changed: 'false',
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        changed: false,
      });
    });

    it('should enable coverage when coverage.changed is enabled from CLI', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            changed: true,
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        changed: true,
      });
    });

    it('should not enable coverage when coverage.changed is disabled from CLI', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            changed: 'false',
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        changed: false,
      });
      expect(projects[0]!.config.coverage.enabled).toBeUndefined();
    });

    it('should enable coverage when coverage provider is set from CLI', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            provider: 'v8',
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        provider: 'v8',
      });
    });

    it('should apply a single coverage.reporters from CLI as an array', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            reporters: 'html',
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        reporters: ['html'],
      });
    });

    it('should apply repeated coverage.reporters from CLI as an array', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            reporters: ['text', 'html'],
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        reporters: ['text', 'html'],
      });
    });

    it('should let CLI coverage.reporters override config reporters', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
              coverage: {
                enabled: true,
                reporters: ['text', ['json', { file: 'coverage.json' }]],
              },
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            reporters: ['lcov'],
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        reporters: ['lcov'],
      });
    });

    it('should override coverage options from CLI', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [
            {
              name: 'test-project',
              coverage: {
                include: ['old-include/**'],
                exclude: ['old-exclude/**'],
                reporters: ['html'],
                reportsDirectory: 'old-coverage',
                clean: true,
              },
            },
          ],
        },
        root: rootPath,
        options: {
          coverage: {
            include: ['src/**', 'test/**'],
            exclude: ['src/generated/**'],
            reporters: ['text', 'json'],
            reportsDirectory: 'custom-coverage',
            reportOnFailure: 'true',
            clean: 'false',
            allowExternal: true,
          },
        },
      });

      expect(projects[0]!.config.coverage).toMatchObject({
        enabled: true,
        include: ['src/**', 'test/**'],
        exclude: ['old-exclude/**', 'src/generated/**'],
        reporters: ['text', 'json'],
        reportsDirectory: 'custom-coverage',
        reportOnFailure: true,
        clean: false,
        allowExternal: true,
      });
    });
  });

  describe('pool CLI options', () => {
    it('should apply --pool shorthand (string) and preserve other pool fields', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [{ name: 'test-project' }],
          pool: { type: 'forks', maxWorkers: '50%' },
        },
        root: rootPath,
        options: { pool: 'forks' },
      });

      expect(projects[0]!.config.pool).toEqual({
        type: 'forks',
      });
    });

    it('should convert string config.pool and apply --pool shorthand', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [{ name: 'test-project' }],
          pool: 'forks',
        },
        root: rootPath,
        options: { pool: 'forks' },
      });

      expect(projects[0]!.config.pool).toEqual({ type: 'forks' });
    });

    it('should merge pool.* options into string config.pool', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [{ name: 'test-project' }],
          pool: 'forks',
        },
        root: rootPath,
        options: {
          pool: {
            maxWorkers: 1,
          },
        },
      });

      expect(projects[0]!.config.pool).toEqual({
        maxWorkers: 1,
      });
    });

    it('should cast pool.execArgv to array', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [{ name: 'test-project' }],
        },
        root: rootPath,
        options: {
          pool: {
            execArgv: '--conditions=development',
          },
        },
      });

      expect(projects[0]!.config.pool).toEqual({
        execArgv: ['--conditions=development'],
      });
    });

    it('should keep pool.execArgv array when passed multiple times', async () => {
      const projects = await resolveProjects({
        config: {
          projects: [{ name: 'test-project' }],
        },
        root: rootPath,
        options: {
          pool: {
            execArgv: ['--conditions=development', '--no-warnings'],
          },
        },
      });

      expect(projects[0]!.config.pool).toEqual({
        execArgv: ['--conditions=development', '--no-warnings'],
      });
    });
  });
});
