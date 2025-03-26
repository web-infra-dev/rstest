import color from 'picocolors';

import type { TestResult } from '../types';

export class DefaultReporter {
  onTestEnd(result: TestResult): void {
    switch (result.status) {
      case 'fail':
        console.log(`  ${color.red('✗')} ${result.prefix}${result.name}`);
        break;
      case 'pass':
        console.log(`  ${color.green('✓')} ${result.prefix}${result.name}`);
        break;
      case 'todo':
      case 'skip':
        console.log(`  ${color.gray('-')} ${result.prefix}${result.name}`);
        break;
      default:
        break;
    }
  }
}
