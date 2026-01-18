import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  color,
  isDebug,
  logger,
  type Rstest,
  rsbuild,
} from '@rstest/core/browser';
import { dirname, join, normalize, resolve } from 'pathe';
import { WebSocketServer } from 'ws';
import { collectProjectEntries } from '../manifest/entries';
import { getBrowserProjects } from '../manifest/projectConfig';
import type { BrowserHostConfig } from '../protocol';
import { getAffectedTestFiles } from '../watch/affectedFiles';
import { watchContext } from '../watch/context';
import { createContainerServer } from './containerServer';
import type { BrowserRuntime, BrowserType } from './types';

const { createRsbuild, rspack } = rsbuild;

const __dirname = dirname(fileURLToPath(import.meta.url));

export const resolveBrowserFile = (relativePath: string): string => {
  const candidates = [
    resolve(__dirname, '../src', relativePath),
    resolve(__dirname, relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve browser client file: ${relativePath}`);
};

export const resolveContainerDist = (): string => {
  const distPath = resolve(__dirname, 'browser-container');
  if (existsSync(distPath)) {
    return distPath;
  }

  throw new Error(
    `Browser container build not found at ${distPath}. Please run "pnpm --filter @rstest/browser build".`,
  );
};

export const destroyBrowserRuntime = async (
  runtime: BrowserRuntime,
): Promise<void> => {
  await runtime.browser?.close?.().catch(() => {});
  await runtime.devServer?.close?.().catch(() => {});
  runtime.wss?.close();
  await fs
    .rm(runtime.tempDir, { recursive: true, force: true })
    .catch(() => {});
};

export const registerWatchCleanup = (runtimeRef: {
  runtime: BrowserRuntime | null;
  cleanupRegistered?: boolean;
}): void => {
  if (runtimeRef.cleanupRegistered) {
    return;
  }

  const cleanup = async () => {
    if (!runtimeRef.runtime) {
      return;
    }
    await destroyBrowserRuntime(runtimeRef.runtime);
    runtimeRef.runtime = null;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void cleanup();
    });
  }

  process.once('exit', () => {
    void cleanup();
  });

  runtimeRef.cleanupRegistered = true;
};

export const createBrowserRuntime = async ({
  context,
  manifestPath,
  manifestSource,
  tempDir,
  isWatchMode,
  onTriggerRerun,
  containerDistPath,
  containerDevServer,
  forceHeadless,
}: {
  context: Rstest;
  manifestPath: string;
  manifestSource: string;
  tempDir: string;
  isWatchMode: boolean;
  onTriggerRerun?: () => Promise<void>;
  containerDistPath?: string;
  containerDevServer?: string;
  /** Force headless mode regardless of user config (used for list command) */
  forceHeadless?: boolean;
}): Promise<BrowserRuntime> => {
  const virtualManifestPlugin = new rspack.experiments.VirtualModulesPlugin({
    [manifestPath]: manifestSource,
  });

  const containerHtmlTemplate = containerDistPath
    ? await fs.readFile(join(containerDistPath, 'container.html'), 'utf-8')
    : null;

  const containerServer = createContainerServer({
    containerHtmlTemplate,
    containerDistPath,
    containerDevServer,
  });

  const setContainerOptions = (options: BrowserHostConfig): void => {
    containerServer.setOptions(options);
  };

  const browserProjects = getBrowserProjects(context);
  const firstProject = browserProjects[0];
  const userPlugins = firstProject?.normalizedConfig.plugins || [];
  const userRsbuildConfig = firstProject?.normalizedConfig ?? {};

  const browserRuntimePath = fileURLToPath(
    import.meta.resolve('@rstest/core/browser-runtime'),
  );

  const rstestInternalAliases = {
    '@rstest/browser-manifest': manifestPath,
    '@rstest/core': resolveBrowserFile('client/public.ts'),
    '@rstest/core/browser-runtime': browserRuntimePath,
    '@sinonjs/fake-timers': resolveBrowserFile('client/fakeTimersStub.ts'),
  };

  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest-browser',
    rsbuildConfig: {
      root: context.rootPath,
      mode: 'development',
      plugins: userPlugins,
      server: {
        printUrls: false,
        port: context.normalizedConfig.browser.port ?? 4000,
        strictPort: context.normalizedConfig.browser.strictPort,
      },
      dev: {
        client: {
          logLevel: 'error',
        },
      },
      environments: {
        web: {},
      },
    },
  });

  rsbuildInstance.addPlugins([
    {
      name: 'rstest:browser-user-config',
      setup(api) {
        api.modifyEnvironmentConfig({
          handler: (config, { mergeEnvironmentConfig }) => {
            const merged = mergeEnvironmentConfig(config, userRsbuildConfig, {
              resolve: {
                alias: rstestInternalAliases,
              },
              output: {
                target: 'web',
                sourceMap: {
                  js: 'source-map',
                },
              },
              tools: {
                rspack: (rspackConfig) => {
                  rspackConfig.mode = 'development';
                  rspackConfig.lazyCompilation = {
                    imports: true,
                    entries: false,
                  };
                  rspackConfig.plugins = rspackConfig.plugins || [];
                  rspackConfig.plugins.push(virtualManifestPlugin);

                  const browserRuntimeDir = dirname(browserRuntimePath);
                  rspackConfig.module = rspackConfig.module || {};
                  rspackConfig.module.rules = rspackConfig.module.rules || [];
                  rspackConfig.module.rules.unshift({
                    test: /\.js$/,
                    include: browserRuntimeDir,
                    extractSourceMap: true,
                  });

                  if (isDebug()) {
                    logger.log(
                      `[rstest:browser] extractSourceMap rule added for: ${browserRuntimeDir}`,
                    );
                  }
                },
              },
            });

            merged.source = merged.source || {};
            merged.source.entry = {
              runner: resolveBrowserFile('client/entry.ts'),
            };

            return merged;
          },
          order: 'post',
        });
      },
    },
  ]);

  if (isWatchMode && onTriggerRerun) {
    rsbuildInstance.addPlugins([
      {
        name: 'rstest:browser-watch',
        setup(api) {
          api.onBeforeDevCompile(() => {
            if (!watchContext.hooksEnabled) {
              return;
            }
            logger.log(color.cyan('\nFile changed, re-running tests...\n'));
          });

          api.onAfterDevCompile(async ({ stats }) => {
            if (stats) {
              const projectEntries = await collectProjectEntries(context);
              const entryTestFiles = new Set<string>(
                projectEntries.flatMap((entry) =>
                  entry.testFiles.map((f) => normalize(f)),
                ),
              );

              const statsJson = stats.toJson({ all: true });
              const affected = getAffectedTestFiles(
                statsJson.chunks,
                entryTestFiles,
              );
              watchContext.affectedTestFiles = affected;

              if (affected.length > 0) {
                logger.debug(
                  `[Watch] Affected test files: ${affected.join(', ')}`,
                );
              }
            }

            if (!watchContext.hooksEnabled) {
              return;
            }

            await onTriggerRerun();
          });
        },
      },
    ]);
  }

  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  devServer.middlewares.use(containerServer.middleware);

  const { port } = await devServer.listen();

  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  const wsPort = (wss.address() as AddressInfo).port;
  logger.debug(`[Browser UI] WebSocket server started on port ${wsPort}`);

  let browserLauncher: BrowserType;
  const browserName = context.normalizedConfig.browser.browser;
  try {
    const playwright = await import('playwright');
    browserLauncher = playwright[browserName];
  } catch (_error) {
    wss.close();
    await devServer.close();
    throw _error;
  }

  let browser: BrowserRuntime['browser'];
  try {
    browser = await browserLauncher.launch({
      headless: forceHeadless ?? context.normalizedConfig.browser.headless,
      args:
        browserName === 'chromium'
          ? [
              '--disable-popup-blocking',
              '--no-first-run',
              '--no-default-browser-check',
            ]
          : undefined,
    });
  } catch (_error) {
    wss.close();
    await devServer.close();
    throw _error;
  }

  return {
    rsbuildInstance,
    devServer,
    browser,
    port,
    wsPort,
    manifestPath,
    tempDir,
    manifestPlugin: virtualManifestPlugin,
    setContainerOptions,
    wss,
  };
};
