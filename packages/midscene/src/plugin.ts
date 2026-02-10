/**
 * Midscene host plugin for rstest browser mode.
 *
 * This plugin registers a message handler with @rstest/browser to handle
 * Midscene AI operations (aiTap, aiInput, aiAssert, etc.) from test runner iframes.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentOpt } from '@midscene/core';
import type { RsbuildPlugin } from '@rsbuild/core';
import type {
  PluginMessageContext,
  RstestBrowserExposedApi,
} from '@rstest/browser';
import {
  AI_RPC_METHODS,
  type AiRpcMethod,
  type AiRpcRequest,
  isAiRpcMethod,
  MIDSCENE_NAMESPACE,
} from './protocol';

type MaybePromise<T> = T | Promise<T>;

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
  | ((ctx: PluginMessageContext) => string | undefined);

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
    ctx: PluginMessageContext,
    profileName: string | undefined,
  ) => MaybePromise<MidsceneAgentOptions | undefined>;

  /**
   * Custom key for Midscene Agent instance cache.
   *
   * Default key: `${testFile}::${profileName ?? 'default'}`
   */
  getAgentCacheKey?: (
    ctx: PluginMessageContext,
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
  ctx: PluginMessageContext,
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

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

/**
 * Normalize and validate incoming plugin RPC payload before dispatch.
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
        const browserApi =
          api.useExposed<RstestBrowserExposedApi>('rstest:browser');
        if (!browserApi) {
          console.warn(
            '[rstest:midscene] @rstest/browser exposed API not found. ' +
              'Make sure browser mode is enabled.',
          );
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
          ctx: PluginMessageContext,
          profileName: string | undefined,
        ): string => {
          return (
            options.getAgentCacheKey?.(ctx, profileName) ||
            `${ctx.testFile}::${profileName || 'default'}`
          );
        };

        const resolveAgentOptions = async (
          ctx: PluginMessageContext,
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
          ctx: PluginMessageContext,
        ): Promise<MidsceneAgent> => {
          const testFile = ctx.testFile;
          const profileName = resolveProfileName(options, ctx);
          const agentCacheKey = getAgentCacheKey(ctx, profileName);
          const containerPage = ctx.getContainerPage();
          const iframeElement = await ctx.getIframeElementForTestFile(testFile);
          const frame = await ctx.getFrameForTestFile(testFile);

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

        browserApi.registerPluginMessageHandler(async (ctx) => {
          const { message } = ctx;

          if (message.payload.namespace !== MIDSCENE_NAMESPACE) {
            return undefined;
          }

          const { request } = message.payload;
          const rawRequest = request as MidsceneRequestLike;
          const responseId: string =
            typeof rawRequest.id === 'string' ? rawRequest.id : '';

          try {
            const { id, method, args } = normalizeRpcRequest(
              request as AiRpcRequest | MidsceneRequestLike,
            );
            const agent = await getOrCreateAgent(ctx);
            const handler = resolveAgentMethod(agent, method);
            if (!handler) {
              throw new Error(`Unknown Midscene method: ${method}`);
            }
            const result = await invokeAgentMethod(agent, handler, args);

            return {
              namespace: MIDSCENE_NAMESPACE,
              response: { id, result },
            };
          } catch (error) {
            return {
              namespace: MIDSCENE_NAMESPACE,
              response: {
                id: responseId,
                error: toErrorMessage(error),
              },
            };
          }
        });

        console.log('[rstest:midscene] Plugin initialized');
      });
    },
  };
}
