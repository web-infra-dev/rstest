import { clsx } from 'clsx';

export function cn(
  ...inputs: Array<string | undefined | null | false>
): string {
  return clsx(inputs);
}
