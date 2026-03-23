import { RsdoctorRspackPlugin } from '@rsdoctor/rspack-plugin';

interface RspackPlugin {
  name: string;
  apply(compiler: unknown): void;
}

/**
 * Returns an Rsdoctor plugin configured for CI bundle analysis.
 *
 * Uses `RSDOCTOR_CI` (not `RSDOCTOR`) to avoid conflict with
 * Rsbuild's built-in Rsdoctor integration which starts an HTTP
 * server and produces a different output format.
 */
export function rsdoctorCIPlugin(): RspackPlugin | null {
  if (process.env.RSDOCTOR_CI !== 'true') {
    return null;
  }

  return new RsdoctorRspackPlugin({
    output: {
      mode: 'brief',
      options: {
        type: ['json'],
      },
    },
  });
}
