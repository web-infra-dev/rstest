import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import istanbulLibCoverage, { type CoverageMap } from 'istanbul-lib-coverage';

export class CoverageProvider implements RstestCoverageProvider {
  constructor(public options: NormalizedCoverageOptions) {}

  async init(): Promise<void> {}
  async collect(): Promise<CoverageMap | null> {
    return null;
  }
  createCoverageMap(): CoverageMap {
    return istanbulLibCoverage.createCoverageMap({});
  }
  async generateCoverageForUntestedFiles(): Promise<any[]> {
    return [];
  }
  async generateReports(_coverageMap: CoverageMap): Promise<void> {}
  cleanup(): void {}
}
