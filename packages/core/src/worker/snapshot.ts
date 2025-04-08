import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { NodeSnapshotEnvironment } from '@vitest/snapshot/environment';
import type { SourceMapInput } from '../types';

interface ParsedStack {
  method: string;
  file: string;
  line: number;
  column: number;
}

export class RstestSnapshotEnvironment extends NodeSnapshotEnvironment {
  private sourceMaps: Record<string, SourceMapInput> = {};

  constructor({
    sourceMaps,
  }: {
    sourceMaps: Record<string, SourceMapInput>;
  }) {
    super();
    this.sourceMaps = sourceMaps;
  }

  // StackTrace is used to parse inline snapshot position
  // The inline snapshot should run code in dist and save snapshot in source
  processStackTrace(stack: ParsedStack): ParsedStack {
    const sourcemap = this.sourceMaps[stack.file];

    if (sourcemap) {
      const traceMap = new TraceMap(sourcemap);
      const { line, column, source, name } = originalPositionFor(traceMap, {
        line: stack.line,
        column: stack.column!,
      });

      return {
        file: source!,
        line: line!,
        method: name!,
        column: column!,
      };
    }

    return stack;
  }
}
