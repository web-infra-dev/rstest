import { describe, expect, it } from '@rstest/core';
import type { ProjectContext, Rstest } from '@rstest/core/internal/browser';
import {
  createBrowserLazyCompilationConfig,
  createBrowserRsbuildDevConfig,
  createBrowserContextExcludeRegExp,
  resolveListenPort,
  toContextKey,
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

  it('should disable HMR in non-watch mode and keep error-only client log', () => {
    const devConfig = createBrowserRsbuildDevConfig(false);

    expect(devConfig.hmr).toBe(false);
    expect(devConfig.client.logLevel).toBe('error');
  });

  it('should enable HMR in watch mode', () => {
    const devConfig = createBrowserRsbuildDevConfig(true);

    expect(devConfig.hmr).toBe(true);
    expect(devConfig.client.logLevel).toBe('error');
  });

  it('should derive the non-watch import-map key like the runtime toContextKey', () => {
    // Keys must match the browser runtime's `toContextKey` so `loadTest(key)`
    // resolves against the manifest import map.
    expect(toContextKey('/project/tests/a.test.ts', '/project')).toBe(
      './tests/a.test.ts',
    );
    // Paths outside the project root are left as-is with a `./` prefix.
    expect(toContextKey('/elsewhere/x.test.ts', '/project')).toBe(
      './elsewhere/x.test.ts',
    );
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

  it('should keep leading dots in browser context exclude patterns', () => {
    const exclude = createBrowserContextExcludeRegExp(
      [
        '**/node_modules/**',
        '**/dist/**',
        '**/.{idea,git,cache,output,temp}/**',
      ],
      '/repo/git/project',
    );

    expect(exclude?.test('/repo/git/project/tests/example.test.ts')).toBe(
      false,
    );
    expect(exclude?.test('/repo/git/project-other/.git/config')).toBe(false);
    expect(exclude?.test('/repo/git/project/.git/config')).toBe(true);
    expect(exclude?.test('/repo/git/project/.cache/output.js')).toBe(true);
    expect(exclude?.test('/repo/git/project/cache/output.js')).toBe(false);
    expect(exclude?.test('/repo/git/project/node_modules/pkg/index.js')).toBe(
      true,
    );
    expect(exclude?.test('tests/example.test.ts')).toBe(false);
    expect(exclude?.test('.git/config')).toBe(true);
    expect(exclude?.test('./.git/config')).toBe(true);
    expect(exclude?.test('./node_modules/pkg/index.js')).toBe(true);
  });

  it('should apply absolute browser context exclude patterns from project root', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/.{idea,git,cache,output,temp}/**'],
      '/tmp/.cache/app',
    );

    expect(exclude?.test('/tmp/.cache/app/tests/example.test.ts')).toBe(false);
    expect(exclude?.test('/tmp/.cache/app/.cache/output.js')).toBe(true);
    expect(exclude?.test('tests/example.test.ts')).toBe(false);
    expect(exclude?.test('.cache/output.js')).toBe(true);
    expect(exclude?.test('./.cache/output.js')).toBe(true);
  });

  it('should match dot-prefixed browser context exclude patterns', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['./fixtures/**'],
      '/repo/project',
    );

    expect(exclude?.test('./fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('.\\fixtures\\example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/src/fixtures/example.test.ts')).toBe(
      false,
    );
    expect(exclude?.test('fixtures/example.test.ts')).toBe(false);
    expect(exclude?.test('./src/fixtures/example.test.ts')).toBe(false);
  });

  it('should match non-globstar relative browser context exclude patterns with ./ prefixes', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['dist/**'],
      '/repo/project',
    );

    expect(exclude?.test('dist/example.test.ts')).toBe(true);
    expect(exclude?.test('./dist/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/dist/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/src/dist/example.test.ts')).toBe(false);
  });

  it('should match dot-prefixed browser context exclude patterns on Windows absolute paths', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['./fixtures/**'],
      'C:\\repo\\project',
    );

    expect(exclude?.test('C:\\repo\\project\\fixtures\\example.test.ts')).toBe(
      true,
    );
    expect(
      exclude?.test('C:\\repo\\project\\src\\fixtures\\example.test.ts'),
    ).toBe(false);
    expect(exclude?.test('.\\fixtures\\example.test.ts')).toBe(true);
  });

  it('should not prefix POSIX absolute browser context exclude patterns twice', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['/repo/project/fixtures/**'],
      '/repo/project',
    );

    expect(exclude?.test('/repo/project/fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/src/fixtures/example.test.ts')).toBe(
      false,
    );
    expect(
      exclude?.test('/repo/project/repo/project/fixtures/example.test.ts'),
    ).toBe(false);
    expect(exclude?.test('./fixtures/example.test.ts')).toBe(false);
  });

  it('should not prefix Windows absolute browser context exclude patterns twice', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['C:\\repo\\project\\fixtures\\**'],
      'C:\\repo\\project',
    );

    expect(exclude?.test('C:\\repo\\project\\fixtures\\example.test.ts')).toBe(
      true,
    );
    expect(
      exclude?.test('C:\\repo\\project\\src\\fixtures\\example.test.ts'),
    ).toBe(false);
    expect(
      exclude?.test(
        'C:\\repo\\project\\C:\\repo\\project\\fixtures\\example.test.ts',
      ),
    ).toBe(false);
    expect(exclude?.test('.\\fixtures\\example.test.ts')).toBe(false);
  });

  it('should scope Windows absolute browser context exclude patterns to project root', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/dist/**'],
      'C:\\repo\\dist\\project',
    );

    expect(
      exclude?.test('C:\\repo\\dist\\project\\tests\\example.test.ts'),
    ).toBe(false);
    expect(exclude?.test('C:\\repo\\dist\\project\\dist\\output.js')).toBe(
      true,
    );
    expect(
      exclude?.test('C:\\repo\\dist\\project-other\\dist\\output.js'),
    ).toBe(false);
    expect(exclude?.test('dist\\output.js')).toBe(true);
  });

  it('should apply hidden-dir browser context exclude patterns on Windows paths', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/.{idea,git,cache,output,temp}/**'],
      'C:\\tmp\\.cache\\app',
    );

    expect(exclude?.test('C:\\tmp\\.cache\\app\\tests\\example.test.ts')).toBe(
      false,
    );
    expect(exclude?.test('C:\\tmp\\.cache\\app\\.cache\\output.js')).toBe(true);
  });

  it('should match hidden files under browser context exclude patterns', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/dist/**'],
      '/repo/project',
    );

    expect(exclude?.test('./dist/.fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/dist/.fixtures/example.test.ts')).toBe(
      true,
    );
    expect(exclude?.test('.dist/.fixtures/example.test.ts')).toBe(false);
    expect(exclude?.test('./src/.fixtures/example.test.ts')).toBe(false);
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
