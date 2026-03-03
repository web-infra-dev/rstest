import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import {
  determineAgent,
  KNOWN_AGENTS,
} from '../../src/utils/agent/detectAgent';

const AGENT_ENV_KEYS = [
  'RSTEST_NO_AGENT',
  'AI_AGENT',
  'CURSOR_TRACE_ID',
  'CURSOR_AGENT',
  'GEMINI_CLI',
  'CODEX_SANDBOX',
  'AUGMENT_AGENT',
  'OPENCODE',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'REPL_ID',
] as const;

function readAgentEnvSnapshot() {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of AGENT_ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreAgentEnv(snapshot: Record<string, string | undefined>) {
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
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = readAgentEnvSnapshot();
    for (const key of AGENT_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    restoreAgentEnv(envSnapshot);
  });

  it('does not detect cursor terminal by CURSOR_TRACE_ID only', () => {
    process.env.CURSOR_TRACE_ID = 'trace-id';

    expect(determineAgent()).toEqual({
      isAgent: false,
      agent: undefined,
    });
  });

  it('detects cursor agent by CURSOR_AGENT', () => {
    process.env.CURSOR_AGENT = '1';

    expect(determineAgent()).toEqual({
      isAgent: true,
      agent: { name: KNOWN_AGENTS.CURSOR_CLI },
    });
  });

  it('keeps opt-out highest priority', () => {
    process.env.RSTEST_NO_AGENT = '1';
    process.env.CURSOR_AGENT = '1';

    expect(determineAgent()).toEqual({
      isAgent: false,
      agent: undefined,
    });
  });
});
