/**
 * pluginMidscene - RsbuildPlugin for Midscene AI testing integration
 *
 * This plugin registers a message handler with @rstest/browser to handle
 * Midscene AI operations (aiTap, aiInput, aiAssert, etc.) from test runner iframes.
 *
 * Usage:
 * ```ts
 * // rstest.config.ts
 * import { pluginMidscene } from '@rstest/midscene/plugin';
 *
 * export default {
 *   browser: {
 *     enabled: true,
 *   },
 *   plugins: [pluginMidscene()],
 * };
 * ```
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RsbuildPlugin } from '@rsbuild/core';
import type {
  PluginMessageContext,
  RstestBrowserExposedApi,
} from '@rstest/browser';

/**
 * Plugin options for pluginMidscene
 */
export interface PluginMidsceneOptions {
  /**
   * Path to .env file for Midscene configuration.
   * Defaults to '.env' in the project root.
   */
  envPath?: string;
}

/**
 * Midscene plugin namespace identifier
 */
const MIDSCENE_NAMESPACE = 'midscene';

/**
 * Create the Midscene RsbuildPlugin for rstest browser mode.
 *
 * This plugin:
 * 1. Loads .env file for Midscene API keys (OPENAI_API_KEY, etc.)
 * 2. Registers a message handler with @rstest/browser for AI operations
 * 3. Creates and caches Midscene Agents per test file
 */
export function pluginMidscene(
  options: PluginMidsceneOptions = {},
): RsbuildPlugin {
  return {
    name: 'rstest:midscene',
    setup(api) {
      // Use onAfterStartDevServer to register handler after browser infrastructure is ready
      api.onAfterStartDevServer(async () => {
        // Get the exposed API from @rstest/browser
        const browserApi =
          api.useExposed<RstestBrowserExposedApi>('rstest:browser');
        if (!browserApi) {
          console.warn(
            '[rstest:midscene] @rstest/browser exposed API not found. ' +
              'Make sure browser mode is enabled.',
          );
          return;
        }

        // Load .env file for Midscene configuration
        const projectRoot = api.context.rootPath;
        const envPath = options.envPath
          ? resolve(projectRoot, options.envPath)
          : resolve(projectRoot, '.env');

        if (existsSync(envPath)) {
          try {
            const dotenv = await import('dotenv');
            dotenv.config({ path: envPath });
            console.log(`[rstest:midscene] Loaded .env from ${envPath}`);
          } catch {
            // dotenv not available, continue without it
          }
        }

        // Cache for Midscene Agents per test file
        type MidsceneAgent = {
          aiTap: (locator: string) => Promise<void>;
          aiRightClick: (locator: string) => Promise<void>;
          aiDoubleClick: (locator: string) => Promise<void>;
          aiHover: (locator: string) => Promise<void>;
          aiInput: (locator: string, value: string) => Promise<void>;
          aiKeyboardPress: (key: string) => Promise<void>;
          aiScroll: (options: unknown) => Promise<void>;
          aiAct: (instruction: string) => Promise<void>;
          aiQuery: <T = unknown>(question: string) => Promise<T>;
          aiAssert: (assertion: string) => Promise<void>;
          aiWaitFor: (condition: string, options?: unknown) => Promise<void>;
          aiLocate: (locator: string) => Promise<unknown>;
          aiBoolean: (question: string) => Promise<boolean>;
          aiNumber: (question: string) => Promise<number>;
          aiString: (question: string) => Promise<string>;
        };
        type AgentCacheEntry = {
          agent: MidsceneAgent;
          updateBindings: (
            containerPage: import('playwright').Page,
            iframeElement: import('playwright').ElementHandle<HTMLIFrameElement>,
            frame: import('playwright').Frame,
          ) => void;
        };
        const agentCache = new Map<string, AgentCacheEntry>();

        // Helper to get or create an Agent for a test file
        const getOrCreateAgent = async (
          ctx: PluginMessageContext,
        ): Promise<MidsceneAgent> => {
          const testFile = ctx.testFile;
          const containerPage = ctx.getContainerPage();
          const iframeElement = await ctx.getIframeElementForTestFile(testFile);
          const frame = await ctx.getFrameForTestFile(testFile);

          const cached = agentCache.get(testFile);
          if (cached) {
            cached.updateBindings(containerPage, iframeElement, frame);
            return cached.agent;
          }

          // Dynamically import HostWebPage (moved to this package)
          const { HostWebPage } = await import('./hostWebPage.js');

          // Create HostWebPage for this iframe
          const hostWebPage = new HostWebPage(
            containerPage,
            iframeElement,
            frame,
          );

          // Ensure action space is built before creating the Agent
          await hostWebPage.ensureActionSpace();

          // Dynamically import @midscene/core Agent
          const { Agent } = await import('@midscene/core');

          // Create Agent with the HostWebPage
          const agent = new Agent(hostWebPage as any);
          const midsceneAgent = agent as unknown as MidsceneAgent;
          agentCache.set(testFile, {
            agent: midsceneAgent,
            updateBindings: hostWebPage.updateBindings.bind(hostWebPage),
          });

          return midsceneAgent;
        };

        // Register the message handler
        browserApi.registerPluginMessageHandler(async (ctx) => {
          const { message } = ctx;

          // Only handle messages for our namespace
          if (message.payload.namespace !== MIDSCENE_NAMESPACE) {
            return undefined;
          }

          const { request } = message.payload;
          const { id, method, args } = request;

          try {
            const agent = await getOrCreateAgent(ctx);
            let result: unknown;

            // Call the appropriate agent method
            switch (method) {
              case 'aiTap':
                await agent.aiTap(args[0] as string);
                break;

              case 'aiRightClick':
                await agent.aiRightClick(args[0] as string);
                break;

              case 'aiDoubleClick':
                await agent.aiDoubleClick(args[0] as string);
                break;

              case 'aiHover':
                await agent.aiHover(args[0] as string);
                break;

              case 'aiInput':
                await agent.aiInput(args[0] as string, args[1] as string);
                break;

              case 'aiKeyboardPress':
                await agent.aiKeyboardPress(args[0] as string);
                break;

              case 'aiScroll':
                await agent.aiScroll(args[0]);
                break;

              case 'aiAct':
                await agent.aiAct(args[0] as string);
                break;

              case 'aiQuery':
                result = await agent.aiQuery(args[0] as string);
                break;

              case 'aiAssert':
                await agent.aiAssert(args[0] as string);
                break;

              case 'aiWaitFor':
                await agent.aiWaitFor(args[0] as string, args[1] as object);
                break;

              case 'aiLocate':
                result = await agent.aiLocate(args[0] as string);
                break;

              case 'aiBoolean':
                result = await agent.aiBoolean(args[0] as string);
                break;

              case 'aiNumber':
                result = await agent.aiNumber(args[0] as string);
                break;

              case 'aiString':
                result = await agent.aiString(args[0] as string);
                break;

              default:
                throw new Error(`Unknown Midscene method: ${method}`);
            }

            return {
              namespace: MIDSCENE_NAMESPACE,
              response: { id, result },
            };
          } catch (error) {
            return {
              namespace: MIDSCENE_NAMESPACE,
              response: {
                id,
                error: (error as Error).message,
              },
            };
          }
        });

        console.log('[rstest:midscene] Plugin initialized');
      });
    },
  };
}
