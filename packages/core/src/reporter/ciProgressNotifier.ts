import { relative } from 'pathe';
import type { RstestTestState, TestResult } from '../types';
import { getTaskNameWithPrefix, prettyTime } from '../utils';

const REPORT_INTERVAL_MS = 30_000;
const SLOW_CASE_THRESHOLD_MS = 10_000;
/** Stop reporting after this many reports to let CI timeout mechanisms take over. */
const MAX_REPORT_COUNT = 20;

/**
 * Periodically logs test progress in non-TTY environments (CI, piped output, AI agents)
 * where the StatusRenderer is not available.
 *
 * Prevents CI "no output" timeouts (e.g. GitHub Actions kills after 10 min of silence)
 * and gives visibility into overall progress.
 */
export class CIProgressNotifier {
  private readonly rootPath: string;
  private readonly testState: RstestTestState;
  private reportTimeout: ReturnType<typeof setTimeout> | undefined;
  private startTime: number | undefined;
  private started = false;
  private reportCount = 0;

  constructor(rootPath: string, testState: RstestTestState) {
    this.rootPath = rootPath;
    this.testState = testState;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.startTime ??= Date.now();
    this.scheduleReport();
  }

  /** Reset the idle timer — call when other output is written to the console. */
  notifyOutput(): void {
    if (this.started) {
      this.scheduleReport();
    }
  }

  stop(): void {
    this.started = false;
    if (this.reportTimeout) {
      clearTimeout(this.reportTimeout);
      this.reportTimeout = undefined;
    }
  }

  private scheduleReport(): void {
    if (this.reportTimeout) {
      clearTimeout(this.reportTimeout);
    }
    this.reportTimeout = setTimeout(() => {
      this.report();
      this.reportCount++;
      if (this.reportCount < MAX_REPORT_COUNT) {
        this.scheduleReport();
      }
    }, REPORT_INTERVAL_MS);
    this.reportTimeout.unref();
  }

  private report(): void {
    const runningModules = this.testState.getRunningModules();
    const testModules = this.testState.getTestModules();

    const doneFiles = testModules.length;

    const allResults: TestResult[] = testModules
      .flatMap((mod) => mod.results)
      .concat(
        Array.from(runningModules.values()).flatMap(({ results }) => results),
      );

    const passed = allResults.filter((r) => r.status === 'pass').length;
    const failed = allResults.filter((r) => r.status === 'fail').length;
    const elapsed = prettyTime(Date.now() - this.startTime!);

    const filePart = `test files: ${doneFiles} done${runningModules.size ? `, ${runningModules.size} running` : ''}`;
    const testParts = [
      passed ? `${passed} passed` : null,
      failed ? `${failed} failed` : null,
    ].filter(Boolean);
    const parts = [
      filePart,
      testParts.length ? `tests: ${testParts.join(', ')}` : null,
      elapsed,
    ].filter(Boolean);

    console.log(`[PROGRESS] ${parts.join(' | ')}`);

    if (runningModules.size > 0) {
      const now = Date.now();
      for (const [module, { runningTests }] of runningModules.entries()) {
        const relativePath = relative(this.rootPath, module);
        const slowCases = runningTests.filter(
          (t) => t.startTime && now - t.startTime > SLOW_CASE_THRESHOLD_MS,
        );
        if (slowCases.length > 0) {
          const caseNames = slowCases
            .map(
              (t) =>
                `${getTaskNameWithPrefix(t)} ${prettyTime(now - t.startTime!)}`,
            )
            .join(', ');
          console.log(`            Running: ${relativePath} > ${caseNames}`);
        } else {
          console.log(`            Running: ${relativePath}`);
        }
      }
    }
  }
}
