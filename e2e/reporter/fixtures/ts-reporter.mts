import type { Reporter, TestRunEndPayload } from '@rstest/core';

export default class TsReporter implements Reporter {
  private readonly marker: unknown;
  private readonly rootPath: string;

  constructor(options: { marker?: unknown }, context: { rootPath: string }) {
    this.marker = options.marker;
    this.rootPath = context.rootPath;
  }

  onTestRunEnd(payload: TestRunEndPayload): void {
    console.log(
      `__RSTEST_TS_REPORTER__${JSON.stringify({
        marker: this.marker,
        status: payload.status,
        rootPath: this.rootPath,
      })}__END__`,
    );
  }
}
