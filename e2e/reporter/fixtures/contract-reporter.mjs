import { setTimeout } from 'node:timers/promises';

export default class ContractReporter {
  events = [];
  pendingStarts = new Map();

  constructor(options, context) {
    this.options = options;
    this.context = context;
  }

  async onTestRunStart(payload) {
    if (process.env.RSTEST_THROW_RUN_START) {
      throw new Error('run-start rejected');
    }
    await setTimeout(25);
    this.selection = payload;
    this.events = [];
  }

  onTestFileStart() {
    if (!this.selection)
      throw new Error('file started before run-start completed');
  }

  async onTestCaseStart(test) {
    this.record('start-enter', test);
    // Prove overlap even when worker transport takes longer than the timer.
    const { promise, resolve } = Promise.withResolvers();
    this.pendingStarts.set(test.testId, resolve);
    await promise;
    await setTimeout(50);
    this.record('start-exit', test);
  }

  async onTestCaseResult(test) {
    this.record('result-enter', test);
    this.pendingStarts.get(test.testId)();
    this.pendingStarts.delete(test.testId);
    await setTimeout(100);
    this.record('result-exit', test);
  }

  onTestFileResult(file) {
    this.record('file-result', file);
  }

  record(event, test) {
    this.events.push({ event, testId: test.testId, testPath: test.testPath });
  }

  onTestRunEnd({ status }) {
    this.events.push({ event: 'run-end' });
    console.log(
      '__RSTEST_REPORTER_CONTRACT__' +
        JSON.stringify({
          marker: this.options.marker,
          options: this.options,
          rootPath: this.context.rootPath,
          name: this.context.config.name,
          selection: this.selection,
          status,
          events: this.events,
        }) +
        '__END__',
    );
  }
}
