import { describe, expect, it } from '@rstest/core';
import type { ProjectContext, Rstest } from '@rstest/core/browser';

/**
 * Create a mock context for testing browser config resolution.
 */
const createMockContext = (options: {
  projectBrowserConfig: Partial<ProjectContext['normalizedConfig']['browser']>;
  rootBrowserConfig: Partial<Rstest['normalizedConfig']['browser']>;
}): Rstest => {
  const { projectBrowserConfig, rootBrowserConfig } = options;

  const browserProject = {
    name: 'browser',
    environmentName: 'browser',
    rootPath: '/project',
    normalizedConfig: {
      browser: {
        enabled: true,
        provider: 'playwright',
        browser: 'chromium',
        headless: false,
        strictPort: false,
        ...projectBrowserConfig,
      },
    },
  } as unknown as ProjectContext;

  return {
    projects: [browserProject],
    normalizedConfig: {
      browser: {
        enabled: false,
        provider: 'playwright',
        browser: 'chromium',
        headless: false,
        strictPort: false,
        ...rootBrowserConfig,
      },
    },
  } as unknown as Rstest;
};

describe('browser config resolution', () => {
  it('should use project-level browser config over root config', () => {
    const context = createMockContext({
      projectBrowserConfig: {
        browser: 'firefox',
        headless: true,
        port: 5000,
        strictPort: true,
      },
      rootBrowserConfig: {
        browser: 'chromium',
        headless: false,
        port: 4000,
        strictPort: false,
      },
    });

    const browserProjects = context.projects.filter(
      (p) => p.normalizedConfig.browser.enabled,
    );
    const firstProject = browserProjects[0];
    const browserConfig =
      firstProject?.normalizedConfig.browser ??
      context.normalizedConfig.browser;

    expect(browserConfig.browser).toBe('firefox');
    expect(browserConfig.headless).toBe(true);
    expect(browserConfig.port).toBe(5000);
    expect(browserConfig.strictPort).toBe(true);
  });

  it('should fallback to root config when no browser projects', () => {
    const context = {
      projects: [],
      normalizedConfig: {
        browser: {
          enabled: false,
          browser: 'webkit',
          headless: true,
          port: 3000,
          strictPort: true,
        },
      },
    } as unknown as Rstest;

    const browserProjects = context.projects.filter(
      (p) => p.normalizedConfig.browser.enabled,
    );
    const firstProject = browserProjects[0];
    const browserConfig =
      firstProject?.normalizedConfig.browser ??
      context.normalizedConfig.browser;

    expect(browserConfig.browser).toBe('webkit');
    expect(browserConfig.headless).toBe(true);
    expect(browserConfig.port).toBe(3000);
    expect(browserConfig.strictPort).toBe(true);
  });
});
