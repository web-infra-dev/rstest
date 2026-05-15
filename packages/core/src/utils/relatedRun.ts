import type { RstestContext } from '../types';

type RelatedRunContext = Pick<
  RstestContext,
  'relatedFilters' | 'relatedMode' | 'relatedResolutionEmpty'
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
