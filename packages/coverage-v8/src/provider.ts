import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { fileURLToPath } from 'node:url';
import type {
  CoverageOptions,
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import istanbulLibCoverage, {
  type CoverageMap,
  type FileCoverageData,
} from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
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
        converter.destroy();

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
  async generateCoverageForUntestedFiles({
    files,
  }: {
    environmentName?: string;
    files: string[];
  }): Promise<FileCoverageData[]> {
    const CHUNK_SIZE = 100;
    const results: (FileCoverageData | null)[] = [];
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (file) => {
          try {
            const converter = v8ToIstanbul(file, 0, undefined, () => false);
            await converter.load();
            converter.applyCoverage([]); // Empty coverage array
            const istanbulData = converter.toIstanbul();
            converter.destroy();
            const keys = Object.keys(istanbulData);
            if (keys.length > 0) {
              return istanbulData[keys[0] as string] as FileCoverageData;
            }
          } catch {
            // Silently ignore failures (e.g. file deleted between test and coverage generation)
          }
          return null;
        }),
      );
      results.push(...chunkResults);
    }
    return results.filter((res): res is FileCoverageData => res !== null);
  }
  async generateReports(
    coverageMap: CoverageMap,
    options?: CoverageOptions,
  ): Promise<void> {
    const opts = { ...this.options, ...(options || {}) };

    const context = createContext({
      dir: opts.reportsDirectory,
      coverageMap: coverageMap,
    });

    const reportersList = opts.reporters || ['text', 'html', 'json'];
    for (const reporter of reportersList) {
      if (typeof reporter === 'object' && 'execute' in reporter) {
        reporter.execute(context);
      } else {
        const [reporterName, reporterOptions] = Array.isArray(reporter)
          ? reporter
          : [reporter, {}];
        const report = reports.create(reporterName as any, reporterOptions);
        report.execute(context);
      }
    }
  }
  cleanup(): void {}
}
