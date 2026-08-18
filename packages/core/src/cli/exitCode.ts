import type { InternalContext } from '../types';

export function mirrorExitCode(context: InternalContext): void {
  context.exitCode.onChange((code) => {
    const hostCode = process.exitCode;
    if (hostCode !== undefined && hostCode !== 0 && hostCode !== '0') {
      return;
    }
    process.exitCode = code;
  });
}
