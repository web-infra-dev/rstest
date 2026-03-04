/**
 * Midscene host plugin for rstest browser mode.
 *
 * This plugin registers a dispatch handler with @rstest/browser (namespace 'midscene')
 * to handle AI operations (aiTap, aiInput, aiAssert, etc.) from test runner iframes.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentOpt } from '@midscene/core';
import type { RsbuildPlugin } from '@rsbuild/core';
import {
  type PlaywrightDispatchContext,
  RSTEST_BROWSER_EXPOSE_ID,
  type RstestBrowserExposedApi,
} from '@rstest/browser/internal';
import {
  AI_RPC_METHODS,
  type AiRpcMethod,
  isAiRpcMethod,
  MIDSCENE_NAMESPACE,
} from './protocol';

type MaybePromise<T> = T | Promise<T>;

type BrowserExposedApi = RstestBrowserExposedApi & {
  // Playwright-only today.
  // Future implementation can introduce a provider-agnostic adapter layer
  // without changing plugin registration flow.
  browser: {
    provider: string;
    playwright: PlaywrightDispatchContext;
  };
};

/**
 * Context object provided to profile/option resolvers.
 * Contains the test file path and Playwright context helpers.
 */
export type MidsceneDispatchContext = {
  /** The test file path associated with this dispatch request. */
  testFile: string;
  /**
   * Playwright context helpers for browser automation.
   * Kept as a Playwright binding for now; can be generalized with a provider
   * adapter if needed.
   */
  playwright: PlaywrightDispatchContext;
};

/**
 * Host-side Midscene Agent options.
 *
 * These options are applied on the Node.js side when creating `new Agent(...)`.
 * Use this for non-serializable configuration such as `createOpenAIClient`,
 * model settings, cache strategy, and report behavior.
 */
export type MidsceneAgentOptions = AgentOpt;

export type MidsceneProfileMap = Record<string, MidsceneAgentOptions>;

export type MidsceneProfileResolver =
  | string
  | ((ctx: MidsceneDispatchContext) => string | undefined);

/**
 * Plugin options for pluginMidscene
 */
export interface PluginMidsceneOptions {
  /**
   * Path to .env file for Midscene configuration.
   * Defaults to '.env' in the project root.
   */
  envPath?: string;

  /**
   * Static host-side defaults applied to every Midscene Agent.
   */
  agentOptions?: MidsceneAgentOptions;

  /**
   * Named host-side option sets.
   *
   * Use with `resolveProfile` to select a profile per test file/request.
   */
  profiles?: MidsceneProfileMap;

  /**
   * Resolves the active profile name.
   *
   * - If omitted and `profiles.default` exists, `default` is used.
   * - If a profile name is resolved but missing from `profiles`, an error is thrown.
   */
  resolveProfile?: MidsceneProfileResolver;

  /**
   * Dynamic host-side option resolver executed on Agent creation.
   *
   * This is useful for deriving options from `testFile`, project context, or env.
   */
  createAgentOptions?: (
    ctx: MidsceneDispatchContext,
    profileName: string | undefined,
  ) => MaybePromise<MidsceneAgentOptions | undefined>;

  /**
   * Custom key for Midscene Agent instance cache.
   *
   * Default key: `${testFile}::${profileName ?? 'default'}`
   */
  getAgentCacheKey?: (
    ctx: MidsceneDispatchContext,
    profileName: string | undefined,
  ) => string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const mergeAgentOptions = (
  ...optionsList: Array<MidsceneAgentOptions | undefined>
): MidsceneAgentOptions | undefined => {
  let merged: MidsceneAgentOptions | undefined;

  for (const current of optionsList) {
    if (!current) {
      continue;
    }

    const prev = merged;
    merged = {
      ...(prev || {}),
      ...current,
    };

    if (isObject(prev?.modelConfig) && isObject(current.modelConfig)) {
      merged.modelConfig = {
        ...prev.modelConfig,
        ...current.modelConfig,
      };
    }
  }

  return merged;
};

const resolveProfileName = (
  options: PluginMidsceneOptions,
  ctx: MidsceneDispatchContext,
): string | undefined => {
  if (typeof options.resolveProfile === 'string') {
    return options.resolveProfile;
  }

  if (typeof options.resolveProfile === 'function') {
    return options.resolveProfile(ctx);
  }

  if (options.profiles?.default) {
    return 'default';
  }

  return undefined;
};

type MidsceneAgentMethod = (...args: unknown[]) => unknown;
type MidsceneAgent = Record<string, MidsceneAgentMethod | undefined>;

type MidsceneRequestLike = {
  id?: unknown;
  method?: unknown;
  args?: unknown;
};

const AGENT_METHOD_ALIASES: Partial<Record<AiRpcMethod, string>> = {
  ai: 'aiAct',
  setAIActContext: 'setAIActionContext',
};

const validateRequestMethod = (method: unknown): method is AiRpcMethod => {
  return isAiRpcMethod(method);
};

const resolveAgentMethod = (
  agent: MidsceneAgent,
  method: AiRpcMethod,
): MidsceneAgentMethod | undefined => {
  const direct = agent[method];
  if (typeof direct === 'function') {
    return direct;
  }

  const alias = AGENT_METHOD_ALIASES[method];
  if (!alias) {
    return undefined;
  }

  const fallback = agent[alias];
  return typeof fallback === 'function' ? fallback : undefined;
};

const invokeAgentMethod = async (
  agent: MidsceneAgent,
  handler: MidsceneAgentMethod,
  args: unknown[],
): Promise<unknown> => {
  return Reflect.apply(handler, agent, args);
};

const resolvePlaywrightContext = (
  api: BrowserExposedApi,
): PlaywrightDispatchContext => {
  const provider = api.browser.provider;
  // Architecture boundary: only Playwright is supported in this package version.
  // Keep the provider enum check here to make intent explicit and leave room for
  // a future adapter-based provider abstraction.
  if (provider !== 'playwright') {
    throw new Error(
      '[rstest:midscene] Midscene requires the Playwright browser provider. ' +
        `Current provider: "${provider}"`,
    );
  }

  return api.browser.playwright;
};

/**
 * Normalize and validate incoming dispatch request payload before dispatch.
 */
const normalizeRpcRequest = (
  request: MidsceneRequestLike,
): {
  id: string;
  method: AiRpcMethod;
  args: unknown[];
} => {
  if (typeof request.id !== 'string' || request.id.length === 0) {
    throw new Error('Invalid Midscene RPC request: missing request id');
  }

  if (!validateRequestMethod(request.method)) {
    throw new Error(
      `Unknown Midscene method: ${String(request.method)}. ` +
        `Supported methods: ${AI_RPC_METHODS.join(', ')}`,
    );
  }

  if (!Array.isArray(request.args)) {
    throw new Error(
      `Invalid Midscene RPC request args for method ${request.method}`,
    );
  }

  return {
    id: request.id,
    method: request.method,
    args: request.args,
  };
};

/**
 * Create the Midscene RsbuildPlugin for rstest browser mode.
 */
export function pluginMidscene(
  options: PluginMidsceneOptions = {},
): RsbuildPlugin {
  return {
    name: 'rstest:midscene',
    setup(api) {
      api.onAfterStartDevServer(async () => {
        const browserApi = api.useExposed<RstestBrowserExposedApi>(
          RSTEST_BROWSER_EXPOSE_ID,
        );
        if (!browserApi) {
          console.warn(
            '[rstest:midscene] @rstest/browser exposed API not found. ' +
              'Make sure browser mode is enabled.',
          );
          return;
        }
        const browserExposedApi = browserApi as BrowserExposedApi;

        let playwrightContext: PlaywrightDispatchContext;
        try {
          playwrightContext = resolvePlaywrightContext(browserExposedApi);
        } catch (error) {
          console.warn(error instanceof Error ? error.message : String(error));
          return;
        }

        const projectRoot = api.context.rootPath;
        const envPath = options.envPath
          ? resolve(projectRoot, options.envPath)
          : resolve(projectRoot, '.env');

        if (existsSync(envPath)) {
          try {
            const dotenv = await import('dotenv');
            dotenv.config({ path: envPath });
            console.log(`[rstest:midscene] Loaded .env from ${envPath}`);
          } catch {}
        }

        type AgentCacheEntry = {
          agent: MidsceneAgent;
          updateBindings: (
            containerPage: import('playwright').Page,
            iframeElement: import('playwright').ElementHandle<HTMLIFrameElement>,
            frame: import('playwright').Frame,
          ) => void;
        };
        const agentCache = new Map<string, AgentCacheEntry>();

        const getProfileOptionsOrThrow = (
          profileName: string | undefined,
        ): MidsceneAgentOptions | undefined => {
          if (!profileName) {
            return undefined;
          }

          const profileOptions = options.profiles?.[profileName];
          if (profileOptions) {
            return profileOptions;
          }

          const availableProfiles = Object.keys(options.profiles || {});
          throw new Error(
            `[rstest:midscene] Unknown profile "${profileName}". ` +
              `Available profiles: ${availableProfiles.join(', ') || '(none)'}`,
          );
        };

        const getAgentCacheKey = (
          ctx: MidsceneDispatchContext,
          profileName: string | undefined,
        ): string => {
          return (
            options.getAgentCacheKey?.(ctx, profileName) ||
            `${ctx.testFile}::${profileName || 'default'}`
          );
        };

        const resolveAgentOptions = async (
          ctx: MidsceneDispatchContext,
          profileName: string | undefined,
        ): Promise<MidsceneAgentOptions | undefined> => {
          const profileOptions = getProfileOptionsOrThrow(profileName);
          const dynamicOptions = await options.createAgentOptions?.(
            ctx,
            profileName,
          );

          return mergeAgentOptions(
            options.agentOptions,
            profileOptions,
            dynamicOptions,
          );
        };

        const getOrCreateAgent = async (
          ctx: MidsceneDispatchContext,
        ): Promise<MidsceneAgent> => {
          const { testFile, playwright } = ctx;
          const profileName = resolveProfileName(options, ctx);
          const agentCacheKey = getAgentCacheKey(ctx, profileName);
          const containerPage = playwright.getContainerPage();
          const iframeElement =
            await playwright.getIframeElementForTestFile(testFile);
          const frame = await playwright.getFrameForTestFile(testFile);

          const cached = agentCache.get(agentCacheKey);
          if (cached) {
            cached.updateBindings(containerPage, iframeElement, frame);
            return cached.agent;
          }

          const { HostWebPage } = await import('./hostWebPage.js');
          const hostWebPage = new HostWebPage(
            containerPage,
            iframeElement,
            frame,
          );

          await hostWebPage.ensureActionSpace();
          const { Agent } = await import('@midscene/core');

          const agentOptions = await resolveAgentOptions(ctx, profileName);

          const agent = agentOptions
            ? new Agent(hostWebPage as any, agentOptions)
            : new Agent(hostWebPage as any);
          const midsceneAgent = agent as unknown as MidsceneAgent;
          agentCache.set(agentCacheKey, {
            agent: midsceneAgent,
            updateBindings: hostWebPage.updateBindings.bind(hostWebPage),
          });

          return midsceneAgent;
        };

        // Register dispatch handler for the 'midscene' namespace.
        // The host dispatch router routes all requests with namespace='midscene' here.
        browserApi.registerDispatchHandler(
          MIDSCENE_NAMESPACE,
          async (request) => {
            const testFile = (
              request.target as { testFile?: string } | undefined
            )?.testFile;
            if (!testFile) {
              throw new Error(
                '@rstest/midscene: dispatch request missing target.testFile',
              );
            }

            const ctx: MidsceneDispatchContext = {
              testFile,
              playwright: playwrightContext,
            };

            const rawRequest = request as unknown as MidsceneRequestLike;
            const { method, args } = normalizeRpcRequest({
              id: request.requestId,
              method: request.method,
              args: Array.isArray(request.args) ? request.args : [],
              ...rawRequest,
            });

            const agent = await getOrCreateAgent(ctx);
            const handler = resolveAgentMethod(agent, method);
            if (!handler) {
              throw new Error(`Unknown Midscene method: ${method}`);
            }

            return invokeAgentMethod(agent, handler, args);
          },
        );

        console.log('[rstest:midscene] Plugin initialized');
      });
    },
  };
}
