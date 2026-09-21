import fs from 'node:fs';
import type { StackFrame } from 'stacktrace-parser';

export async function renderCodeFrame(
  frame: Pick<StackFrame, 'file' | 'lineNumber' | 'column'>,
  {
    linesAbove,
    linesBelow,
    ansi,
  }: { linesAbove: number; linesBelow: number; ansi: boolean },
): Promise<string | undefined> {
  if (!frame.file || !fs.existsSync(frame.file)) return;
  const { codeFrameColumns } = await import('@babel/code-frame');
  return codeFrameColumns(
    fs.readFileSync(frame.file, 'utf-8'),
    { start: { line: frame.lineNumber ?? 1, column: frame.column ?? 1 } },
    { highlightCode: ansi, forceColor: ansi, linesAbove, linesBelow },
  );
}
