import { describe, expect, it } from '@rstest/core';
import { join } from 'pathe';
import { resolveProjects } from '../../src/cli/init';
import type { RstestConfig } from '../../src/types';

const rootPath = join(__dirname, '../..');

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
});
