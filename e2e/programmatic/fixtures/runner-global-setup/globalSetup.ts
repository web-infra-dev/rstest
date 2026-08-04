import { appendFileSync } from 'node:fs';

// Global setup runs in a forked child, so the host hands the log path over
// through the environment and reads the file back to observe both phases.
const requireLogFile = (): string => {
  const logFile = process.env.RSTEST_RUNNER_E2E_LOG;
  if (!logFile) {
    throw new Error(
      'RSTEST_RUNNER_E2E_LOG must point at the runner e2e log file',
    );
  }
  return logFile;
};

export default function globalSetup(): () => void {
  const logFile = requireLogFile();
  appendFileSync(logFile, 'setup\n');

  return () => {
    appendFileSync(logFile, 'teardown\n');
    if (process.env.RSTEST_RUNNER_E2E_TEARDOWN_FAIL) {
      throw new Error('teardown failed intentionally');
    }
  };
}
