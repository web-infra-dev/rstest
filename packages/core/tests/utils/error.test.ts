import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import stripAnsi from 'strip-ansi';
import { renderCodeFrame } from '../../src/utils/codeFrame';
import { formatStack, parseErrorStacktrace } from '../../src/utils/error';

describe('error helpers', () => {
  it('uses the mapped method name', async () => {
    const [frame] = await parseErrorStacktrace({
      stack:
        'Error: failed\n    at generatedMethod (/project/generated.js:1:1)',
      fullStack: true,
      getSourcemap: async () => ({
        version: 3,
        names: ['mappedMethod'],
        sources: ['source.ts'],
        mappings: 'AAAAA',
      }),
    });

    expect(frame?.methodName).toBe('mappedMethod');
    expect(formatStack(frame!, '/project')).toContain('mappedMethod');
    expect(formatStack(frame!, '/project')).not.toContain('generatedMethod');
  });

  it('renders asymmetric plain and ANSI code frames', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-frame-'));
    const file = path.join(directory, 'source.ts');
    fs.writeFileSync(file, ['one', 'two', 'three', 'four', 'five'].join('\n'));
    onTestFinished(() =>
      fs.rmSync(directory, { recursive: true, force: true }),
    );

    const frame = { file, lineNumber: 3, column: 2, methodName: 'test' };
    const plain = await renderCodeFrame(frame, {
      linesAbove: 1,
      linesBelow: 2,
      ansi: false,
    });
    const ansi = await renderCodeFrame(frame, {
      linesAbove: 1,
      linesBelow: 2,
      ansi: true,
    });

    expect(plain).toBe(
      ['  2 | two', '> 3 | three', '    |  ^', '  4 | four', '  5 | five'].join(
        '\n',
      ),
    );
    expect(ansi).toContain('\u001B[');
    expect(stripAnsi(ansi!)).toBe(plain);
  });
});
