import { runInNewContext } from 'node:vm';
import type { CoverageMap, FileCoverageData } from 'istanbul-lib-coverage';
import type { MapStore } from 'istanbul-lib-source-maps';

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
    if (openBraceIndex < 0) throw new Error('cannot find open brace');
    const char = code[openBraceIndex];
    if (char === '}') remainOpenBraceCount++;
    else if (char === '{') remainOpenBraceCount--;
  }

  let closeBraceIndex = magicValueIndex;
  let remainCloseBraceCount = 1;
  while (remainCloseBraceCount > 0) {
    closeBraceIndex++;
    if (closeBraceIndex >= code.length)
      throw new Error('cannot find close brace');
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

// https://github.com/webpack/webpack/blob/99c36fab8e8b21885f02cca76c253f51b97997eb/lib/util/extractSourceMap.js#L53

// Matches only the last occurrence of sourceMappingURL
const innerRegex = /\s*[#@]\s*sourceMappingURL\s*=\s*([^\s'"]*)\s*/;

const sourceMappingURLRegex = new RegExp(
  '(?:' +
    '/\\*' +
    '(?:\\s*\r?\n(?://)?)?' +
    `(?:${innerRegex.source})` +
    '\\s*' +
    '\\*/' +
    '|' +
    `//(?:${innerRegex.source})` +
    ')' +
    '\\s*',
);

/**
 * Extract source mapping URL from code comments
 * @param {string} code source code content
 * @returns {SourceMappingURL} source mapping information
 */
function getSourceMappingURL(code: string): string | undefined {
  const lines = code.split(/^/m);
  let match: RegExpMatchArray | null | undefined = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    match = lines[i]?.match(sourceMappingURLRegex);
    if (match) {
      break;
    }
  }

  const sourceMappingURL = match ? match[1] || match[2] || '' : '';

  return sourceMappingURL ? decodeURI(sourceMappingURL) : sourceMappingURL;
}

export async function registerSourceMapURL(
  filename: string,
  code: string,
  sourcemapUrlCache: Map<string, string | undefined>,
): Promise<void> {
  // process js/cjs/mjs file only
  if (!filename.endsWith('js')) return;

  const url = getSourceMappingURL(code);
  sourcemapUrlCache.set(filename, url);
}

export async function transformCoverage(
  coverageMap: CoverageMap,
  sourcemapUrlCache: Map<string, string | undefined>,
): Promise<CoverageMap> {
  await Promise.all(
    coverageMap
      .files()
      // process js/cjs/mjs file only
      .filter((filename) => filename.endsWith('js'))
      .map(async (filename) => {
        let url = sourcemapUrlCache.get(filename);
        if (!url) {
          const { readFile } = await import('node:fs/promises');
          const content = await readFile(filename, 'utf8');
          url = getSourceMappingURL(content);
        }
        sourcemapUrlCache.set(filename, url);
      }),
  );

  // Call createSourceMapStore as needed
  let store: MapStore | undefined;
  for (const [filename, url] of sourcemapUrlCache) {
    if (url) {
      if (!store) {
        const { createSourceMapStore } = await import(
          'istanbul-lib-source-maps'
        );
        store = createSourceMapStore();
      }
      store.registerURL(filename, url);
    }
  }
  if (store) return store.transformCoverage(coverageMap);

  return coverageMap;
}
