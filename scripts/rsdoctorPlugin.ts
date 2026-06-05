import { RsdoctorRspackPlugin } from '@rsdoctor/rspack-plugin';

interface RsdoctorCIPluginOptions {
  /**
   * Custom report directory for Rsdoctor output.
   * Use this when multiple libs in the same package need separate reports.
   */
  reportDir?: string;
}

/**
 * Returns an Rsdoctor plugin configured for CI bundle analysis.
 *
 * Uses `RSDOCTOR_CI` (not `RSDOCTOR`) to avoid conflict with
 * Rsbuild's built-in Rsdoctor integration which starts an HTTP
 * server and produces a different output format.
 */
export function rsdoctorCIPlugin(
  options?: RsdoctorCIPluginOptions,
): InstanceType<typeof RsdoctorRspackPlugin> | null {
  if (process.env.RSDOCTOR_CI !== 'true') {
    return null;
  }

  return new RsdoctorRspackPlugin({
    output: {
      mode: 'brief',
      options: {
        type: ['json'],
      },
      reportDir: options?.reportDir || '.rsdoctor',
    },
  });
}
