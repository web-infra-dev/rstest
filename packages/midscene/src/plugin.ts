/**
 * Midscene host plugin for rstest browser mode.
 *
 * This plugin registers a dispatch handler with @rstest/browser (namespace 'midscene')
 * to handle AI operations (aiTap, aiInput, aiAssert, etc.) from test runner iframes.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RsbuildPlugin } from '@rsbuild/core';
import {
  RSTEST_BROWSER_EXPOSE_ID,
  type RstestBrowserExposedApi,
} from '@rstest/browser/internal';
import {
  createMidsceneAgentRuntime,
  type MidsceneAgent,
} from './pluginAgentRuntime';
import {
  appendReportPathToError,
  logMidsceneEnvLoaded,
  logMidsceneMethodFinish,
  logMidsceneMethodStart,
  logMidscenePluginInitialized,
  logMidsceneWarning,
} from './pluginLogging';
import type {
  MidsceneDispatchContext,
  PluginMidsceneOptions,
} from './pluginTypes';
import {
  AI_RPC_METHODS,
  type AiRpcMethod,
  isAiRpcMethod,
  MIDSCENE_NAMESPACE,
} from './protocol';

type MidsceneAgentMethod = (...args: unknown[]) => unknown;

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

const asAgentMethod = (value: unknown): MidsceneAgentMethod | undefined => {
  return typeof value === 'function'
    ? (value as MidsceneAgentMethod)
    : undefined;
};

const resolveAgentMethod = (
  agent: MidsceneAgent,
  method: AiRpcMethod,
): MidsceneAgentMethod | undefined => {
  const direct = agent[method];
  const directMethod = asAgentMethod(direct);
  if (directMethod) {
    return directMethod;
  }

  const alias = AGENT_METHOD_ALIASES[method];
  if (!alias) {
    return undefined;
  }

  const fallback = agent[alias];
  return asAgentMethod(fallback);
};

const invokeAgentMethod = async (
  agent: MidsceneAgent,
  handler: MidsceneAgentMethod,
  args: unknown[],
): Promise<unknown> => {
  return Reflect.apply(handler, agent, args);
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
          logMidsceneWarning(
            '@rstest/browser exposed API not found. Make sure browser mode is enabled.',
          );
          return;
        }
        const playwrightContext = browserApi.playwright;

        const projectRoot = api.context.rootPath;
        const envPath = options.envPath
          ? resolve(projectRoot, options.envPath)
          : resolve(projectRoot, '.env');

        if (existsSync(envPath)) {
          try {
            const dotenv = await import('dotenv');
            dotenv.config({ path: envPath });
            logMidsceneEnvLoaded(envPath);
          } catch {}
        }

        const { getOrCreateAgent } = createMidsceneAgentRuntime(options);

        // Register dispatch handler for the 'midscene' namespace.
        // The host dispatch router routes all requests with namespace='midscene' here.
        browserApi.dispatch.registerDispatchHandler(
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

            const startTime = Date.now();
            logMidsceneMethodStart(method, args);

            try {
              const result = await invokeAgentMethod(agent, handler, args);
              logMidsceneMethodFinish(
                method,
                args,
                Date.now() - startTime,
                agent,
              );
              return result;
            } catch (error) {
              throw appendReportPathToError(error, agent.reportFile);
            }
          },
        );

        logMidscenePluginInitialized();
      });
    },
  };
}
