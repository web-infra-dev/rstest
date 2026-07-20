import type {
  CoverageMap,
  CoverageProvider,
  RawCoverageResolveOptions,
} from '../types/coverage';

type RunCoverageStep = <T>(
  label: string,
  fn: () => Promise<T>,
  options?: {
    slowMessage?: string;
    slowDoneMessage?: string;
  },
) => Promise<T>;

export const resolveAndMergeRawCoverage = async ({
  coverageProvider,
  mergedCoverageMap,
  rawCoverageResults,
  resolveOptions,
  runCoverageStep,
}: {
  coverageProvider: CoverageProvider | null;
  mergedCoverageMap?: CoverageMap;
  rawCoverageResults: unknown[];
  resolveOptions?: RawCoverageResolveOptions;
  runCoverageStep: RunCoverageStep;
}): Promise<void> => {
  const resolveRawCoverage =
    coverageProvider?.resolveRawCoverage?.bind(coverageProvider);
  if (!rawCoverageResults.length || !resolveRawCoverage) {
    return;
  }

  const rawCoverageMap = await runCoverageStep(
    'coverage collect',
    async () => resolveRawCoverage(rawCoverageResults, resolveOptions),
    {
      slowMessage: 'processing coverage results...',
      slowDoneMessage: 'coverage results processed.',
    },
  );
  if (rawCoverageMap) {
    mergedCoverageMap?.merge(rawCoverageMap);
  }
};
