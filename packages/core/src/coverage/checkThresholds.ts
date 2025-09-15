import type {
  CoverageMap,
  CoverageSummary,
  CoverageThresholds,
} from '../types/coverage';
import { color } from '../utils';

export function checkThresholds(
  coverageMap: CoverageMap,
  thresholds?: CoverageThresholds,
): { success: boolean; message: string } {
  if (!thresholds) {
    return { success: true, message: '' };
  }
  const summary = coverageMap.getCoverageSummary();
  const failedThresholds: string[] = [];

  const check = (
    name: keyof CoverageSummary,
    type: string,
    actual: number,
    expected?: number,
  ) => {
    if (expected !== undefined && actual < expected) {
      failedThresholds.push(
        `Coverage for ${name} ${color.red(`${actual}%`)} does not meet ${type} threshold ${color.yellow(`${expected}%`)}`,
      );
    }
  };
  // Check global thresholds
  check('statements', 'global', summary.statements.pct, thresholds.statements);
  check('functions', 'global', summary.functions.pct, thresholds.functions);
  check('branches', 'global', summary.branches.pct, thresholds.branches);
  check('lines', 'global', summary.lines.pct, thresholds.lines);

  return {
    success: failedThresholds.length === 0,
    message: failedThresholds.join('\n'),
  };
}
