import yn from 'yn';
import { determineAgent } from './detectAgent';
export { determineAgent };

export const isAgentEnv = (): boolean => {
  const rawValue = process.env.RSTEST_AI_AGENT;
  const value = rawValue?.trim();

  if (!value) {
    return false;
  }

  const parsed = yn(value);
  if (parsed === false) {
    return false;
  }

  return true;
};

export const initAgentEnv = (): void => {
  const { isAgent, agent } = determineAgent();
  if (!isAgent) {
    return;
  }

  process.env.RSTEST_AI_AGENT ||= agent?.name || 'unknown';
  process.env.FORCE_COLOR = '0';
  process.env.NO_COLOR = '1';
};
