import type { IstanbulFileCoverageData } from '../src/utils';

export const createFileCoverage = (file: string): IstanbulFileCoverageData => ({
  path: file,
  statementMap: {
    0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
  },
  fnMap: {
    0: {
      name: 'fn',
      decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      line: 1,
    },
  },
  branchMap: {
    0: {
      type: 'if',
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      locations: [
        { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
        { start: { line: 1, column: 5 }, end: { line: 1, column: 10 } },
      ],
      line: 1,
    },
  },
  s: { 0: 1 },
  f: { 0: 2 },
  b: { 0: [3, 4] },
  hash: 'same',
});
