// Adapted from Vue's generateCodeFrame:
// https://github.com/vuejs/core/blob/main/packages/shared/src/codeframe.ts
// Copyright (c) 2018-present, Yuxi (Evan) You and Vue contributors.
// MIT license; see the Vue entry in LICENSE.md.
import type { Colors } from 'picocolors/types';

/** Lines rendered around the target line; callers may narrow the window. */
export interface CodeFrameWindow {
  linesAbove?: number;
  linesBelow?: number;
}

export function generateCodeFrame(
  source: string,
  line: number | null,
  column: number | null,
  colors: Colors,
  { linesAbove = 2, linesBelow = 2 }: CodeFrameWindow = {},
): string {
  const lines = source.split(/\r\n|[\n\r\u2028\u2029]/);
  if (!line || line < 1 || line > lines.length) {
    return '';
  }

  const start = Math.max(1, line - linesAbove);
  const end = Math.min(lines.length, line + linesBelow);
  const width = String(end).length;
  const frame: string[] = [];

  for (let i = start; i <= end; i++) {
    const content = lines[i - 1]!;
    const gutter = colors.gray(`${String(i).padStart(width)} |`);
    const marker = i === line ? colors.red(colors.bold('>')) : ' ';
    frame.push(`${marker} ${gutter}${content ? ` ${content}` : ''}`);

    if (i === line && column && column > 0) {
      // Preserve tabs so the pointer follows the terminal's tab stops.
      const padding = content.slice(0, column - 1).replace(/[^\t]/g, ' ');
      frame.push(
        `  ${colors.gray(`${' '.repeat(width)} |`)} ${padding}${colors.red(colors.bold('^'))}`,
      );
    }
  }

  return frame.join('\n');
}
