import { logger } from '@rstest/core/browser';
import type { TestFileInfo } from '../protocol';
import type { ContainerRpcManager } from '../rpc/containerRpcManager';

/**
 * Enforces file-level concurrency limits for browser mode.
 */
export class TestFileScheduler {
  private queue: TestFileInfo[] = [];
  private running: Set<string> = new Set();
  private maxWorkers: number;
  private rpcManager: ContainerRpcManager;
  private onAllComplete?: () => void;
  private fatalOccurred = false;

  constructor(
    maxWorkers: number,
    rpcManager: ContainerRpcManager,
    onAllComplete?: () => void,
  ) {
    this.maxWorkers = maxWorkers;
    this.rpcManager = rpcManager;
    this.onAllComplete = onAllComplete;
  }

  start(testFiles: TestFileInfo[]): void {
    this.queue = [...testFiles];
    this.running.clear();
    this.fatalOccurred = false;
    this.dispatchNext();
  }

  onTestFileComplete(testPath: string): void {
    this.running.delete(testPath);
    logger.debug(
      `[Scheduler] Test file complete: ${testPath}, running: ${this.running.size}, queue: ${this.queue.length}`,
    );

    if (this.fatalOccurred) {
      return;
    }

    this.dispatchNext();

    if (this.running.size === 0 && this.queue.length === 0) {
      this.onAllComplete?.();
    }
  }

  onFatal(): void {
    this.fatalOccurred = true;
    this.queue = [];
    if (this.running.size === 0) {
      this.onAllComplete?.();
    }
  }

  private dispatchNext(): void {
    while (
      this.running.size < this.maxWorkers &&
      this.queue.length > 0 &&
      !this.fatalOccurred
    ) {
      const testFile = this.queue.shift();
      if (testFile) {
        this.running.add(testFile.testPath);
        logger.debug(
          `[Scheduler] Dispatching test file: ${testFile.testPath}, running: ${this.running.size}`,
        );
        this.rpcManager.reloadTestFile(testFile.testPath).catch((error) => {
          logger.debug(
            `[Scheduler] Failed to dispatch test file: ${testFile.testPath}, error: ${error}`,
          );
          this.onTestFileComplete(testFile.testPath);
        });
      }
    }
  }

  scheduleFiles(testFiles: TestFileInfo[]): void {
    this.fatalOccurred = false;

    for (const testFile of testFiles) {
      if (
        this.running.has(testFile.testPath) ||
        this.queue.some((q) => q.testPath === testFile.testPath)
      ) {
        logger.debug(
          `[Scheduler] Skipping already scheduled file: ${testFile.testPath}`,
        );
        continue;
      }
      this.queue.push(testFile);
    }

    logger.debug(
      `[Scheduler] Scheduled ${testFiles.length} file(s), queue: ${this.queue.length}, running: ${this.running.size}`,
    );

    this.dispatchNext();
  }

  getState(): { running: number; queued: number; fatal: boolean } {
    return {
      running: this.running.size,
      queued: this.queue.length,
      fatal: this.fatalOccurred,
    };
  }
}
