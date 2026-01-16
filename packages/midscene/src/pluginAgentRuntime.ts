import type { ElementHandle, Frame, Page } from 'playwright';
import type { MidsceneLogAgent } from './pluginLogging';
import type {
  MidsceneAgentOptions,
  MidsceneDispatchContext,
  PluginMidsceneOptions,
} from './pluginTypes';

export type MidsceneAgent = Record<string, unknown> & MidsceneLogAgent;

type AgentCacheEntry = {
  agent: MidsceneAgent;
  updateBindings: (
    containerPage: Page,
    iframeElement: ElementHandle<HTMLIFrameElement>,
    frame: Frame,
  ) => void;
};

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

const getProfileOptionsOrThrow = (
  options: PluginMidsceneOptions,
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

const resolveAgentCacheKey = (
  options: PluginMidsceneOptions,
  ctx: MidsceneDispatchContext,
  profileName: string | undefined,
): string => {
  return (
    options.getAgentCacheKey?.(ctx, profileName) ||
    `${ctx.testFile}::${profileName || 'default'}`
  );
};

const resolveAgentOptions = async (
  options: PluginMidsceneOptions,
  ctx: MidsceneDispatchContext,
  profileName: string | undefined,
): Promise<MidsceneAgentOptions | undefined> => {
  const profileOptions = getProfileOptionsOrThrow(options, profileName);
  const dynamicOptions = await options.createAgentOptions?.(ctx, profileName);

  return mergeAgentOptions(
    options.agentOptions,
    profileOptions,
    dynamicOptions,
  );
};

export const createMidsceneAgentRuntime = (
  options: PluginMidsceneOptions,
): {
  getOrCreateAgent: (ctx: MidsceneDispatchContext) => Promise<MidsceneAgent>;
} => {
  const agentCache = new Map<string, AgentCacheEntry>();

  const getOrCreateAgent = async (
    ctx: MidsceneDispatchContext,
  ): Promise<MidsceneAgent> => {
    const { testFile, provider } = ctx;
    const profileName = resolveProfileName(options, ctx);
    const agentCacheKey = resolveAgentCacheKey(options, ctx, profileName);
    const containerPage = provider.getContainerPage() as Page;
    const iframeElement = (await provider.getIframeElementForTestFile(
      testFile,
    )) as ElementHandle<HTMLIFrameElement>;
    const frame = (await provider.getFrameForTestFile(testFile)) as Frame;

    const cached = agentCache.get(agentCacheKey);
    if (cached) {
      cached.updateBindings(containerPage, iframeElement, frame);
      return cached.agent;
    }

    const { HostWebPage } = await import('./hostWebPage.js');
    const hostWebPage = new HostWebPage(containerPage, iframeElement, frame);

    await hostWebPage.ensureActionSpace();
    const { Agent } = await import('@midscene/core');

    const agentOptions = await resolveAgentOptions(options, ctx, profileName);
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

  return {
    getOrCreateAgent,
  };
};
