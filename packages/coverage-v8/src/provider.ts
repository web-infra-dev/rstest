import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { fileURLToPath } from 'node:url';
import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import istanbulLibCoverage, { type CoverageMap } from 'istanbul-lib-coverage';
import picomatch from 'picomatch';
import v8ToIstanbul from 'v8-to-istanbul';

export class CoverageProvider implements RstestCoverageProvider {
  private session: inspector.Session | null = null;

  constructor(public options: NormalizedCoverageOptions) {}

  async init(): Promise<void> {
    this.session = new inspector.Session();
    this.session.connect();
    await this.session.post('Profiler.enable');
    await this.session.post('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: true,
    });
  }

  async collect(): Promise<CoverageMap | null> {
    if (!this.session) return null;

    let coverage: inspector.Profiler.TakePreciseCoverageReturnType;
    try {
      coverage = await this.session.post('Profiler.takePreciseCoverage');
    } finally {
      await this.session.post('Profiler.stopPreciseCoverage');
      await this.session.post('Profiler.disable');
      this.session.disconnect();
      this.session = null;
    }

    const coverageMap = this.createCoverageMap();

    const isExcluded = this.options.exclude
      ? picomatch(this.options.exclude)
      : () => false;
    const isIncluded = this.options.include
      ? picomatch(this.options.include)
      : () => true;

    for (const entry of coverage.result) {
      if (!entry.url.startsWith('file://')) continue;

      const filePath = fileURLToPath(entry.url);

      if (filePath.includes('/node_modules/') || filePath.includes('@rstest/'))
        continue;

      if (isExcluded(filePath) || !isIncluded(filePath)) continue;

      try {
        const converter = v8ToIstanbul(
          filePath,
          0,
          { source: await fs.readFile(filePath, 'utf-8') },
          (filepath) => {
            return (
              filepath.includes('node_modules') ||
              filepath.includes('@rstest') ||
              isExcluded(filepath) ||
              !isIncluded(filepath)
            );
          },
        );

        await converter.load();
        converter.applyCoverage(entry.functions);
        const istanbulData = converter.toIstanbul();

        coverageMap.merge(istanbulData);
      } catch (e) {
        console.warn(`Failed to process coverage for ${entry.url}:`, e);
      }
    }

    return coverageMap;
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
