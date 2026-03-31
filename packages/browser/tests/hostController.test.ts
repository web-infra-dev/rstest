import { describe, expect, it } from '@rstest/core';
import type { ProjectContext, Rstest } from '@rstest/core/browser';
import {
  createBrowserLazyCompilationConfig,
  createBrowserRsbuildDevConfig,
  resolveListenPort,
} from '../src/hostController';

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

  it('should enable HMR in non-watch mode and keep error-only client log', () => {
    const devConfig = createBrowserRsbuildDevConfig(false);

    expect(devConfig.hmr).toBe(true);
    expect(devConfig.client.logLevel).toBe('error');
  });

  it('should enable HMR in watch mode', () => {
    const devConfig = createBrowserRsbuildDevConfig(true);

    expect(devConfig.hmr).toBe(true);
    expect(devConfig.client.logLevel).toBe('error');
  });

  it('should keep setup files out of lazy compilation', () => {
    const lazyCompilation = createBrowserLazyCompilationConfig([
      '/project/tests/rstest.setup.ts',
    ]);

    expect(lazyCompilation.imports).toBe(true);
    expect(lazyCompilation.entries).toBe(false);
    expect(
      lazyCompilation.test?.({
        nameForCondition: () => '/project/tests/rstest.setup.ts',
      }),
    ).toBe(false);
    expect(
      lazyCompilation.test?.({
        nameForCondition: () => '/project/tests/example.test.tsx',
      }),
    ).toBe(true);
  });

  it('should normalize setup file paths before filtering lazy compilation', () => {
    const lazyCompilation = createBrowserLazyCompilationConfig([
      '/project/tests/rstest.setup.ts',
    ]);

    expect(
      lazyCompilation.test?.({
        nameForCondition: () => '/project/tests/../tests/rstest.setup.ts',
      }),
    ).toBe(false);
  });
});

describe('resolveListenPort', () => {
  it('should return listenPort when it is non-zero', () => {
    expect(resolveListenPort(4000, null)).toBe(4000);
  });

  it('should fall back to httpServer.address() when listenPort is 0', () => {
    const httpServer = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 52341 }),
    };
    expect(resolveListenPort(0, httpServer)).toBe(52341);
  });

  it('should return 0 when both listenPort and httpServer are unavailable', () => {
    expect(resolveListenPort(0, null)).toBe(0);
  });

  it('should return 0 when httpServer.address() returns a string', () => {
    const httpServer = { address: () => '/tmp/sock' as unknown as null };
    expect(resolveListenPort(0, httpServer as any)).toBe(0);
  });
});
