import fs from 'node:fs';

export type CodeFrameOptions = {
  linesAbove: number;
  linesBelow: number;
  line?: number;
  column?: number;
};

export const createCodeFrame = (
  filePath: string,
  { linesAbove, linesBelow, line, column }: CodeFrameOptions,
): string | null => {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const source = fs.readFileSync(filePath, 'utf-8');
  const sourceLines = source.split(/\r?\n/);
  const lineNumber = Math.max(1, line || 1);
  const columnNumber = Math.max(1, column || 1);
  const start = Math.max(1, lineNumber - linesAbove);
  const end = Math.min(sourceLines.length, lineNumber + linesBelow);
  const lineWidth = String(end).length;
  const frameLines: string[] = [];

  for (let i = start; i <= end; i += 1) {
    const linePrefix = String(i).padStart(lineWidth, ' ');
    const lineContent = sourceLines[i - 1] ?? '';
    frameLines.push(`${linePrefix} | ${lineContent}`);
    if (i === lineNumber) {
      const marker = ' '.repeat(Math.max(0, columnNumber - 1));
      frameLines.push(`${' '.repeat(lineWidth)} | ${marker}^`);
    }
  }

  return frameLines.join('\n');
};
