/**
 * Node worker tasks cross an IPC structured-clone boundary. Keep this check
 * host-side so an unsupported environment option fails before a task is
 * dispatched and is not reported as a worker crash.
 */
export const assertWorkerEnvironmentOptions = (
  options: Record<string, unknown> | undefined,
): void => {
  try {
    structuredClone(options ?? {});
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(
      'Node worker pools require `testEnvironment.options` to be structured-cloneable because the options are sent to a worker.' +
        ' Use cloneable values or move equivalent callback setup into a setup file.' +
        reason,
    );
  }
};
