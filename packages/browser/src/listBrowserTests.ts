import {
  color,
  type FormattedError,
  isDebug,
  type ListCommandResult,
  logger,
  type Rstest,
  TEMP_RSTEST_OUTPUT_DIR,
  type Test,
} from '@rstest/core/browser';
import { join, normalize } from 'pathe';
import type { ConsoleMessage } from 'playwright';
import {
  collectProjectEntries,
  generateManifestModule,
  getBrowserProjects,
  getRuntimeConfigFromProject,
} from './manifest/index';
import type { BrowserHostConfig, BrowserProjectRuntime } from './protocol';
import {
  createBrowserRuntime,
  destroyBrowserRuntime,
} from './runtime/browserRuntime';
import type { BrowserRuntime } from './runtime/types';

export type ListBrowserTestsResult = {
  list: ListCommandResult[];
  close: () => Promise<void>;
};

export const listBrowserTests = async (
  context: Rstest,
): Promise<ListBrowserTestsResult> => {
  const projectEntries = await collectProjectEntries(context);
  const totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  if (totalTests === 0) {
    return {
      list: [],
      close: async () => {},
    };
  }

  const tempDir = join(
    context.rootPath,
    TEMP_RSTEST_OUTPUT_DIR,
    'browser',
    `list-${Date.now()}`,
  );
  const manifestPath = join(tempDir, 'manifest.ts');

  const manifestSource = generateManifestModule({
    manifestPath,
    entries: projectEntries,
  });

  let runtime: BrowserRuntime;
  try {
    runtime = await createBrowserRuntime({
      context,
      manifestPath,
      manifestSource,
      tempDir,
      isWatchMode: false,
      containerDistPath: undefined,
      containerDevServer: undefined,
      forceHeadless: true,
    });
  } catch (error) {
    logger.error(
      color.red(
        'Failed to load Playwright. Please install "playwright" to use browser mode.',
      ),
      error,
    );
    throw error;
  }

  const { browser, port } = runtime;

  const browserProjects = getBrowserProjects(context);
  const projectRuntimeConfigs: BrowserProjectRuntime[] = browserProjects.map(
    (project) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      runtimeConfig: getRuntimeConfigFromProject(project),
    }),
  );

  const maxTestTimeoutForRpc = Math.max(
    ...browserProjects.map((p) => p.normalizedConfig.testTimeout ?? 5000),
  );

  const hostOptions: BrowserHostConfig = {
    rootPath: normalize(context.rootPath),
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
    },
    mode: 'collect',
    debug: isDebug(),
    rpcTimeout: maxTestTimeoutForRpc,
  };

  runtime.setContainerOptions(hostOptions);

  const collectResults: ListCommandResult[] = [];
  let fatalError: Error | null = null;
  let collectCompleted = false;

  let resolveCollect: (() => void) | undefined;
  const collectPromise = new Promise<void>((resolve) => {
    resolveCollect = resolve;
  });

  const browserContext = await browser.newContext({ viewport: null });
  const page = await browserContext.newPage();

  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if (text.includes('[Container]') || text.includes('[Runner]')) {
      logger.log(color.gray(`[Browser Console] ${text}`));
    }
  });

  type CollectTestResult = {
    testPath: string;
    tests: Test[];
    errors?: FormattedError[];
  };

  const handleRpcMessage = async (data: { type: string; payload: any }) => {
    if (data.type === 'collect') {
      const { testPath, tests, errors } = data.payload as CollectTestResult;

      const formattedErrors: FormattedError[] = [];
      if (errors?.length) {
        formattedErrors.push(...errors);
      }

      collectResults.push({
        testPath,
        tests,
        errors: formattedErrors.length > 0 ? formattedErrors : undefined,
        project: 'browser',
      });
    }

    if (data.type === 'done') {
      collectCompleted = true;
      resolveCollect?.();
    }

    if (data.type === 'fatal') {
      fatalError = new Error(data.payload.message || 'Unknown fatal error');
      if (data.payload.stack) {
        fatalError.stack = data.payload.stack;
      }
      collectCompleted = true;
      resolveCollect?.();
    }
  };

  const rpc = runtime.wss;
  rpc.on('connection', (ws) => {
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        await handleRpcMessage(data);
      } catch {
        // ignore invalid messages
      }
    });
  });

  await page.goto(`http://localhost:${port}/`, {
    waitUntil: 'load',
  });

  const collectTimeoutMs = maxTestTimeoutForRpc + 30_000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const collectTimeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.log(
        color.yellow(
          `\nTest collection timeout after ${collectTimeoutMs / 1000}s\n`,
        ),
      );
      resolve();
    }, collectTimeoutMs);
  });

  await Promise.race([collectPromise, collectTimeout]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  await browserContext.close();
  await destroyBrowserRuntime(runtime);

  if (fatalError) {
    throw fatalError;
  }

  if (!collectCompleted) {
    throw new Error('Browser test collection did not complete.');
  }

  return {
    list: collectResults,
    close: async () => {},
  };
};
