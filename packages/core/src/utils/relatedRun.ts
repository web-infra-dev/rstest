import type { RstestContext } from '../types';

type RelatedRunContext = Pick<
  RstestContext,
  | 'relatedFilters'
  | 'relatedMode'
  | 'relatedResolutionEmpty'
  | 'relatedRerunFiles'
>;

export const getNoTestFilesMessage = ({
  context,
  code,
  defaultMessage,
}: {
  context: RelatedRunContext;
  code: number;
  defaultMessage: string;
}): string => {
  if (!context.relatedResolutionEmpty) {
    return defaultMessage;
  }

  if (context.relatedMode === 'changed' && !context.relatedFilters?.length) {
    return `No changed files found, exiting with code ${code}.`;
  }

  const filterLabel =
    context.relatedMode === 'changed'
      ? 'changed files'
      : 'related source files';

  return `No test files found for ${filterLabel}, exiting with code ${code}.`;
};

export const formatForceRerunTriggerFiles = (files: string[]): string => {
  const [firstFile, ...otherFiles] = files;

  if (!firstFile) {
    return 'files';
  }

  if (otherFiles.length === 0) {
    return `file(${firstFile})`;
  }

  const suffix = otherFiles.length === 1 ? 'file' : 'files';

  return `files(${firstFile} and ${otherFiles.length} ${suffix})`;
};

export const getForceRerunTriggerMessage = (
  context: RelatedRunContext,
): string =>
  `Changed ${formatForceRerunTriggerFiles(
    context.relatedRerunFiles ?? [],
  )} matched forceRerunTriggers, running all test files.`;
