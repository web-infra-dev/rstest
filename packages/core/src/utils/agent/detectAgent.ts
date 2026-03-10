import { type AgentName, detectAgent as detectAgentFromStdEnv } from 'std-env';

export type KnownAgentNames = AgentName;

export interface KnownAgentDetails {
  name: KnownAgentNames;
}

export type AgentResult =
  | {
      isAgent: true;
      agent: KnownAgentDetails;
    }
  | {
      isAgent: false;
      agent: undefined;
    };

export function determineAgent(): AgentResult {
  if (process.env.RSTEST_NO_AGENT === '1') {
    return { isAgent: false, agent: undefined };
  }

  const agent = detectAgentFromStdEnv();
  if (agent.name) {
    return {
      isAgent: true,
      agent: { name: agent.name as KnownAgentNames },
    };
  }

  return { isAgent: false, agent: undefined };
}
