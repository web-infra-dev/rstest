import { runInNewContext } from 'node:vm';
import type { FileCoverageData } from 'istanbul-lib-coverage';

// ATTENTION: when swc-plugin-coverage-instrument version changed, magic value should be updated too
// https://github.com/kwonoj/swc-plugin-coverage-instrument/blob/63e9d5e16dbe61073c62af4b7dfed3c1779cbafa/spec/util/constants.ts#L1-L2
const COVERAGE_MAGIC_KEY = '_coverageSchema';
const COVERAGE_MAGIC_VALUE = '11020577277169172593';

// generated code looks like this:

// var coverageData = { <--- find until open brace
//   all: false,
//   path: '',
//   statementMap: {},
//   fnMap: {},
//   branchMap: {},
//   s: {},
//   f: {},
//   b: {},
//   _coverageSchema: '11020577277169172593', <--- from here
//   hash: '',
// }; <--- and until close brace

export function readInitialCoverage(
  code: string,
): FileCoverageData | undefined {
  const magicValueIndex = code.indexOf(COVERAGE_MAGIC_VALUE);
  if (magicValueIndex === -1) throw new Error('cannot find magic value');

  let openBraceIndex = magicValueIndex;
  let remainOpenBraceCount = 1;
  while (remainOpenBraceCount > 0) {
    openBraceIndex--;
    if (openBraceIndex < 0) throw new Error('');
    const char = code[openBraceIndex];
    if (char === '}') remainOpenBraceCount++;
    else if (char === '{') remainOpenBraceCount--;
  }

  let closeBraceIndex = magicValueIndex;
  let remainCloseBraceCount = 1;
  while (remainCloseBraceCount > 0) {
    closeBraceIndex++;
    if (closeBraceIndex >= code.length) throw new Error('');
    const char = code[closeBraceIndex];
    if (char === '{') remainCloseBraceCount++;
    else if (char === '}') remainCloseBraceCount--;
  }

  const coverageDataStr = code.slice(openBraceIndex, closeBraceIndex + 1);
  const coverageData = runInNewContext(`Object(${coverageDataStr})`);
  if (coverageData?.[COVERAGE_MAGIC_KEY] !== COVERAGE_MAGIC_VALUE)
    throw new Error('invalid coverageData');

  return coverageData;
}
