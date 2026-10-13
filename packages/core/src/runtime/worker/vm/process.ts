export const isBlockedProcessKillTarget = (
  pid: number,
  currentPid: number,
): boolean => pid === 0 || pid === -1 || Math.abs(pid) === currentPid;

export const installVmProcessGuards = (): (() => void) => {
  const exit = process.exit.bind(process);
  process.exit = (code): never => {
    const effectiveCode = code ?? Reflect.get(process, 'exitCode') ?? 0;
    throw new Error(`process.exit unexpectedly called with "${effectiveCode}"`);
  };

  const kill = process.kill.bind(process);
  process.kill = (pid: number, signal?: NodeJS.Signals) => {
    // On POSIX, pid 0 targets the current process group. A VM test must not
    // be able to signal the host shell or sibling workers through this shared
    // worker-thread process.
    if (isBlockedProcessKillTarget(pid, process.pid)) {
      throw new Error(
        `process.kill unexpectedly called with "${pid}" and "${signal}"`,
      );
    }
    return kill(pid, signal);
  };

  return () => {
    process.kill = kill;
    process.exit = exit;
  };
};
