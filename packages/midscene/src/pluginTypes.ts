import type { AgentOpt } from '@midscene/core';
import type { PlaywrightDispatchContext } from '@rstest/browser/internal';

type MaybePromise<T> = T | Promise<T>;

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
