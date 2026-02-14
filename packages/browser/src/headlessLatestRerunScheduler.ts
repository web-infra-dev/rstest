export type HeadlessLatestRerunScheduler<TFile> = {
  enqueueLatest: (files: TFile[]) => Promise<void>;
  whenIdle: () => Promise<void>;
};

type HeadlessLatestRerunSchedulerOptions<TFile, TRun> = {
  getActiveRun: () => TRun | null;
  isRunCancelled: (run: TRun) => boolean;
  invalidateActiveRun: () => void;
  interruptActiveRun: (run: TRun) => Promise<void>;
  runFiles: (files: TFile[]) => Promise<void>;
  onError?: (error: unknown) => Promise<void> | void;
  onInterrupt?: (run: TRun) => void;
};

/**
 * Latest-only rerun scheduler for headless watch mode.
 * Keeps only the newest pending payload and interrupts active run generations.
 */
export const createHeadlessLatestRerunScheduler = <TFile, TRun>(
  options: HeadlessLatestRerunSchedulerOptions<TFile, TRun>,
): HeadlessLatestRerunScheduler<TFile> => {
  let pendingFiles: TFile[] | null = null;
  let draining: Promise<void> | null = null;
  let latestEnqueueVersion = 0;

  const runDrainLoop = async (): Promise<void> => {
    while (pendingFiles) {
      const nextFiles = pendingFiles;
      pendingFiles = null;

      try {
        await options.runFiles(nextFiles);
      } catch (error) {
        try {
          await options.onError?.(error);
        } catch {
          // Keep draining even if error reporting fails.
        }
      }
    }
  };

  const ensureDrainLoop = (): void => {
    if (draining) {
      return;
    }

    draining = runDrainLoop().finally(() => {
      draining = null;
    });
  };

  return {
    async enqueueLatest(files: TFile[]): Promise<void> {
      const enqueueVersion = ++latestEnqueueVersion;
      const activeRun = options.getActiveRun();
      if (activeRun && !options.isRunCancelled(activeRun)) {
        options.onInterrupt?.(activeRun);
        options.invalidateActiveRun();
        await options.interruptActiveRun(activeRun);
      }

      // If a newer enqueue arrived while interrupting, drop this stale payload.
      if (enqueueVersion !== latestEnqueueVersion) {
        return;
      }

      pendingFiles = files;
      ensureDrainLoop();
    },
    async whenIdle(): Promise<void> {
      await draining;
    },
  };
};
