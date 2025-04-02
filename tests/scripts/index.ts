import type { Options } from 'tinyexec';
import { x } from 'tinyexec';

export async function runRstestCli({
  command,
  options,
  args,
}: { command: string; options?: Partial<Options>; args?: any[] }) {
  const subprocess = await x(command, args, options as Options);
  return subprocess;
}
