import { expect, it, rs } from '@rstest/core';
import { ProgressReporter } from '../../src/worker/reporter';

let resultAcknowledgement = Promise.withResolvers<void>();

rs.mock('../../src/worker', () => {
  const acknowledged = () => resultAcknowledgement.promise;
  const event = Object.assign(acknowledged, {
    asEvent: async () => {},
  });
  const immediate = Object.assign(async () => {}, {
    asEvent: async () => {},
  });
  return {
    masterApi: {
      onTestRunStart: immediate,
      onTestRunEnd: immediate,
      onTestFileStart: immediate,
      onTestFileReady: immediate,
      onTestFileResult: event,
      onTestSuiteStart: immediate,
      onTestSuiteResult: immediate,
      onTestCaseStart: immediate,
      onTestCaseResult: event,
    },
  };
});

it('waits for result callbacks to finish in the extension host', async () => {
  const reporter = new ProgressReporter();
  for (const report of [
    () => reporter.onTestCaseResult({} as any),
    () => reporter.onTestSuiteResult({} as any),
    () => reporter.onTestFileResult({} as any),
  ]) {
    resultAcknowledgement = Promise.withResolvers<void>();
    let settled = false;
    const reporting = report().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resultAcknowledgement.resolve();
    await reporting;
    expect(settled).toBe(true);
  }
});
