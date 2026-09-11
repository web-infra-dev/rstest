import type { SerializedError, ListCommandCollectionResult } from '../types';
import { parseErrorStacktrace } from '../utils/error';

/** @experimental Subject to change until 1.0.0. */
export class ListTestsError extends Error {
  override readonly name = 'ListTestsError';

  constructor(
    public files: { testPath: string; errors: SerializedError[] }[],
    public unhandledErrors: SerializedError[],
  ) {
    super('Failed to list tests.');
  }
}

export const createListTestsError = async (
  result: ListCommandCollectionResult,
): Promise<ListTestsError> => {
  const serialize = async (
    error: SerializedError,
  ): Promise<SerializedError> => {
    const serialized = { ...error };
    if (error.stack) {
      const frames = await parseErrorStacktrace({
        stack: error.stack,
        fullStack: true,
        getSourcemap: async (name) => {
          const sourceMap = await result.getSourceMap(name);
          return sourceMap ? JSON.parse(sourceMap) : null;
        },
      });
      if (!frames.length) {
        return serialized;
      }
      // Keep absolute, uncolored V8 frames so hosts can parse them after close().
      serialized.stack = [
        `${serialized.name}: ${serialized.message}`,
        ...frames.map((frame) => {
          const location = `${frame.file}:${frame.lineNumber}:${frame.column}`;
          return frame.methodName === '<unknown>'
            ? `    at ${location}`
            : `    at ${frame.methodName} (${location})`;
        }),
      ].join('\n');
    }
    return serialized;
  };

  return new ListTestsError(
    await Promise.all(
      result.list
        .filter((file) => file.errors?.length)
        .map(async (file) => ({
          testPath: file.testPath,
          errors: await Promise.all(file.errors!.map(serialize)),
        })),
    ),
    await Promise.all(result.errors.map(serialize)),
  );
};
