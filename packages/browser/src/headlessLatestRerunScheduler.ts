type HeadlessLatestRerunScheduler<TFile> = {
  enqueueLatest: (files: TFile[]) => Promise<void>;
  whenIdle: () => Promise<void>;
};

type HeadlessLatestRerunSchedulerOptions<TFile> = {
  runFiles: (files: TFile[]) => Promise<void>;
  onError?: (error: unknown) => Promise<void> | void;
};

/**
 * Latest-only rerun scheduler for headless watch mode.
 * Serializes reruns so late duplicate watch events coalesce into a pending run
 * instead of interrupting Playwright while it may still be dispatching protocol
 * objects.
 */
export const createHeadlessLatestRerunScheduler = <TFile>(
  options: HeadlessLatestRerunSchedulerOptions<TFile>,
): HeadlessLatestRerunScheduler<TFile> => {
  let pendingFiles: TFile[] | null = null;
  let draining: Promise<void> | null = null;

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
      pendingFiles = files;
      ensureDrainLoop();
    },
    async whenIdle(): Promise<void> {
      await draining;
    },
  };
};
