import type {
  CoverageMap,
  CoverageSummary,
  CoverageSummaryTotals,
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
    actual: CoverageSummaryTotals,
    expected?: number,
  ) => {
    if (expected !== undefined) {
      // Thresholds specified as a negative number represent the maximum number of uncovered entities allowed.
      if (expected < 0) {
        const uncovered = actual.total - actual.covered;
        if (uncovered > -expected) {
          failedThresholds.push(
            `${color.red('Error')}: Uncovered ${name} ${color.red(`${uncovered}`)} exceeds maximum ${type} threshold allowed ${color.yellow(`${-expected}`)}`,
          );
        }
      }
      // Thresholds specified as a positive number are taken to be the minimum percentage required.
      else if (actual.pct < expected) {
        failedThresholds.push(
          `${color.red('Error')}: Coverage for ${name} ${color.red(`${actual.pct}%`)} does not meet ${type} threshold ${color.yellow(`${expected}%`)}`,
        );
      }
    }
  };
  // Check global thresholds
  check('statements', 'global', summary.statements, thresholds.statements);
  check('functions', 'global', summary.functions, thresholds.functions);
  check('branches', 'global', summary.branches, thresholds.branches);
  check('lines', 'global', summary.lines, thresholds.lines);

  return {
    success: failedThresholds.length === 0,
    message: failedThresholds.join('\n'),
  };
}
