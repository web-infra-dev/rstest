import { describe, expect, it } from '@rstest/core';
import {
  claimHeadedCycleScope,
  createBrowserLazyCompilationConfig,
  createBrowserRsbuildDevConfig,
  createBrowserContextExcludeRegExp,
  registerWatchCleanup,
  resolveEmptyLaunchExitCode,
  resolveListenPort,
  runWatchRuntimeTeardown,
  shouldEnableBrowserHmr,
  toContextKey,
} from '../src/hostController';

describe('browser config resolution', () => {
  it('should disable HMR when enableHmr is false and keep error-only client log', () => {
    const devConfig = createBrowserRsbuildDevConfig(false);

    expect(devConfig.hmr).toBe(false);
    expect(devConfig.client.logLevel).toBe('error');
  });

  it('should enable HMR when enableHmr is true', () => {
    const devConfig = createBrowserRsbuildDevConfig(true);

    expect(devConfig.hmr).toBe(true);
    expect(devConfig.client.logLevel).toBe('error');
  });

  it('should only enable HMR for headed watch', () => {
    // Headless never reuses a page, so it never consumes HMR — enabling it only
    // exposes the #11922 factory race and the #1472 accept-chain throw. One-shot
    // runs never rerun. So HMR (and the lazyCompilation transport it carries) is
    // gated to headed watch alone.
    expect(shouldEnableBrowserHmr(true, false)).toBe(true); // headed watch
    expect(shouldEnableBrowserHmr(true, true)).toBe(false); // headless watch
    expect(shouldEnableBrowserHmr(false, false)).toBe(false); // headed one-shot
    expect(shouldEnableBrowserHmr(false, true)).toBe(false); // headless one-shot
  });

  it('should derive the non-watch import-map key like the runtime toContextKey', () => {
    // Keys must match the browser runtime's `toContextKey` so `loadTest(key)`
    // resolves against the manifest import map.
    expect(toContextKey('/project/tests/a.test.ts', '/project')).toBe(
      './tests/a.test.ts',
    );
    // Paths outside the project root keep their absolute form so the runtime
    // `toAbsolutePath` round-trips them instead of re-rooting under projectRoot.
    expect(toContextKey('/elsewhere/x.test.ts', '/project')).toBe(
      '/elsewhere/x.test.ts',
    );
    // A sibling that only shares a string prefix with the root is not stripped
    // at a non-boundary (would otherwise mangle to `./-extra/a.test.ts`); it is
    // outside the root, so it is also kept absolute.
    expect(toContextKey('/repo/pkg-extra/a.test.ts', '/repo/pkg')).toBe(
      '/repo/pkg-extra/a.test.ts',
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

describe('resolveEmptyLaunchExitCode', () => {
  const watchLaunch = {
    allowEmptyRun: false,
    isWatchMode: true,
    passWithNoTests: false,
  };

  it('should fail a watch launch that found no test files', () => {
    expect(resolveEmptyLaunchExitCode(undefined, watchLaunch)).toBe(1);
    expect(resolveEmptyLaunchExitCode(0, watchLaunch)).toBe(1);
  });

  it('should never downgrade a code an earlier failure already raised', () => {
    expect(resolveEmptyLaunchExitCode(2, watchLaunch)).toBe(2);
  });

  it('should leave the code to the cycle outside watch mode', () => {
    expect(
      resolveEmptyLaunchExitCode(undefined, {
        ...watchLaunch,
        isWatchMode: false,
      }),
    ).toBeUndefined();
  });

  it('should leave the code alone when no tests is not a failure', () => {
    expect(
      resolveEmptyLaunchExitCode(undefined, {
        ...watchLaunch,
        passWithNoTests: true,
      }),
    ).toBeUndefined();
    expect(
      resolveEmptyLaunchExitCode(undefined, {
        ...watchLaunch,
        allowEmptyRun: true,
      }),
    ).toBeUndefined();
  });
});

describe('claimHeadedCycleScope', () => {
  const testFile = (testPath: string) => ({
    testPath,
    projectName: 'browser',
  });

  it('claims only the patterns of the paths in its own scope', () => {
    // The race the per-file map exists for: a rebuild cycle for one file is
    // dequeued while a click on another is still waiting for the cycle it
    // signalled. The rebuild must not run with — or swallow — that pattern.
    const patterns = new Map([
      ['/a.test.ts', 'sums'],
      ['/b.test.ts', 'renders'],
    ]);
    const currentTestFiles = [testFile('/a.test.ts'), testFile('/b.test.ts')];

    const scope = claimHeadedCycleScope(
      ['/a.test.ts'],
      currentTestFiles,
      patterns,
    );

    expect(scope).toEqual([
      { file: currentTestFiles[0], testNamePattern: 'sums' },
    ]);
    expect([...patterns]).toEqual([['/b.test.ts', 'renders']]);
  });

  it('consumes a pattern once, so a later cycle runs the whole file', () => {
    const patterns = new Map([['/a.test.ts', 'sums']]);
    const currentTestFiles = [testFile('/a.test.ts')];

    const claimed = claimHeadedCycleScope(
      ['/a.test.ts'],
      currentTestFiles,
      patterns,
    );
    const afterwards = claimHeadedCycleScope(
      ['/a.test.ts'],
      currentTestFiles,
      patterns,
    );

    expect(claimed[0]!.testNamePattern).toBe('sums');
    expect(afterwards[0]!.testNamePattern).toBeUndefined();
  });

  it('skips a path the file set no longer has and keeps every live one', () => {
    // A queued scope goes stale when a later trigger rebuilds the file set
    // without one of its files. Skipping is what the headless twin does;
    // failing the cycle would take the surviving files down with it.
    const currentTestFiles = [testFile('/a.test.ts'), testFile('/c.test.ts')];

    const scope = claimHeadedCycleScope(
      ['/a.test.ts', '/deleted.test.ts', '/c.test.ts'],
      currentTestFiles,
      new Map(),
    );

    expect(scope.map(({ file }) => file.testPath)).toEqual([
      '/a.test.ts',
      '/c.test.ts',
    ]);
  });

  it('leaves a skipped path’s pattern for whichever cycle runs the file', () => {
    // The file set can be rebuilt back — the click's pattern is only spent when
    // a cycle actually carries the file. Consuming it on the way past would turn
    // the user's single-test click into a full-file rerun, silently.
    const patterns = new Map([['/a.test.ts', 'sums']]);

    const skipped = claimHeadedCycleScope(['/a.test.ts'], [], patterns);
    const later = claimHeadedCycleScope(
      ['/a.test.ts'],
      [testFile('/a.test.ts')],
      patterns,
    );

    expect(skipped).toEqual([]);
    expect(later[0]!.testNamePattern).toBe('sums');
  });

  it('normalizes the scope paths before matching files and patterns', () => {
    // The scope arrives from core's cycle options while the file set and the
    // pattern map are keyed on normalized paths.
    const patterns = new Map([['/a.test.ts', 'sums']]);
    const currentTestFiles = [testFile('/a.test.ts')];

    const scope = claimHeadedCycleScope(
      ['/tests/../a.test.ts'],
      currentTestFiles,
      patterns,
    );

    expect(scope).toEqual([
      { file: currentTestFiles[0], testNamePattern: 'sums' },
    ]);
  });
});

describe('runWatchRuntimeTeardown', () => {
  const createState = () => ({
    runtime: 'runtime-1' as string | null,
    cleanupPromise: null as Promise<void> | null,
  });

  it('destroys the runtime once for concurrent callers', async () => {
    const destroyed: string[] = [];
    const state = createState();

    await Promise.all([
      runWatchRuntimeTeardown(state, async (runtime) => {
        destroyed.push(runtime);
      }),
      runWatchRuntimeTeardown(state, async (runtime) => {
        destroyed.push(runtime);
      }),
    ]);

    expect(destroyed).toEqual(['runtime-1']);
    expect(state.runtime).toBeNull();
  });

  it('tears down the runtime a config restart re-cached', async () => {
    // The memo must not outlive the runtime it was taken for: a config-file
    // change tears the session down, re-caches a fresh runtime, and the next
    // teardown has to destroy that one rather than short-circuit on the
    // previous session's resolved promise.
    const destroyed: string[] = [];
    const state = createState();
    const destroy = async (runtime: string) => {
      destroyed.push(runtime);
    };

    await runWatchRuntimeTeardown(state, destroy);
    state.runtime = 'runtime-2';
    await runWatchRuntimeTeardown(state, destroy);

    expect(destroyed).toEqual(['runtime-1', 'runtime-2']);
    expect(state.runtime).toBeNull();
  });

  it('releases the memo even when teardown throws', async () => {
    const state = createState();

    await expect(
      runWatchRuntimeTeardown(state, async () => {
        throw new Error('destroy failed');
      }),
    ).rejects.toThrow('destroy failed');

    expect(state.cleanupPromise).toBeNull();
  });
});

describe('registerWatchCleanup', () => {
  it('installs the process nets once, so a restart cannot stack them', () => {
    // The other half of releasing the teardown memo: the memo is per runtime,
    // these nets are not. They read the cached runtime live, so they stay
    // correct across a config restart — and re-arming them alongside the memo
    // would leave a fresh, never-removed set behind on every teardown.
    const registered: string[] = [];
    const original = process.once;
    // Recorded rather than installed: these are `process.once` handlers nothing
    // removes, and the test worker outlives the test.
    process.once = ((event: string) => {
      registered.push(event);
      return process;
    }) as typeof process.once;

    try {
      registerWatchCleanup(false);
      const afterFirst = [...registered];
      registerWatchCleanup(false);

      expect(afterFirst).toContain('exit');
      expect(afterFirst).toContain('SIGINT');
      expect(registered).toEqual(afterFirst);
    } finally {
      process.once = original;
    }
  });
});
