import { type AgentName, detectAgent as detectAgentFromStdEnv } from 'std-env';

type KnownAgentNames = AgentName;

interface KnownAgentDetails {
  name: KnownAgentNames;
}

type AgentResult =
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
      agent: { name: agent.name },
    };
  }

  return { isAgent: false, agent: undefined };
}
