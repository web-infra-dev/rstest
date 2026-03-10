import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { determineAgent } from '../../src/utils/agent/detectAgent';

const AGENT_ENV_KEYS = ['RSTEST_NO_AGENT', 'AI_AGENT', 'OPENCODE'] as const;

function snapshotAgentEnv() {
  const snapshot = {} as Record<
    (typeof AGENT_ENV_KEYS)[number],
    string | undefined
  >;
  for (const key of AGENT_ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function resetAgentEnv() {
  for (const key of AGENT_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreAgentEnv(
  snapshot: Record<(typeof AGENT_ENV_KEYS)[number], string | undefined>,
) {
  for (const key of AGENT_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('determineAgent', () => {
  let envSnapshot: Record<(typeof AGENT_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotAgentEnv();
    resetAgentEnv();
  });

  afterEach(() => {
    restoreAgentEnv(envSnapshot);
  });

  it('delegates agent detection to std-env', () => {
    process.env.AI_AGENT = 'custom-agent';

    expect(determineAgent()).toEqual({
      isAgent: true,
      agent: { name: 'custom-agent' },
    });
  });

  it('keeps opt-out highest priority', () => {
    process.env.RSTEST_NO_AGENT = '1';
    process.env.AI_AGENT = 'custom-agent';

    expect(determineAgent()).toEqual({
      isAgent: false,
      agent: undefined,
    });
  });
});
