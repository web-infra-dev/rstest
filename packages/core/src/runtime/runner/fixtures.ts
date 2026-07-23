import type {
  Fixtures,
  NormalizedFixture,
  NormalizedFixtures,
  TestCase,
} from '../../types';
import { isObject } from '../../utils/helper';

export const normalizeFixtures = (
  fixtures: Fixtures = {},
  extendFixtures: NormalizedFixtures = {},
): NormalizedFixtures => {
  const result: NormalizedFixtures = {};
  for (const key in fixtures) {
    const fixtureOptionKeys = ['auto'];
    // @ts-expect-error
    const value = fixtures[key]!;
    if (Array.isArray(value)) {
      if (value.length === 1 && typeof value[0] === 'function') {
        result[key] = {
          isFn: true,
          value: value[0],
        };
        continue;
      }
      if (
        isObject(value[1]) &&
        Object.keys(value[1]).some((key) => fixtureOptionKeys.includes(key))
      ) {
        result[key] = {
          isFn: typeof value[0] === 'function',
          value: value[0],
          options: value[1],
        };
        continue;
      }
    }
    result[key] = {
      isFn: typeof value === 'function',
      value,
    };
  }
  const formattedResult = Object.fromEntries(
    Object.entries(result).map(([key, value]) => {
      if (value.isFn) {
        const usedProps = getFixtureUsedProps(value.value);
        value.deps = usedProps.filter(
          (p) => p in result || p in extendFixtures,
        );
      }
      return [key, value];
    }),
  );

  return {
    ...extendFixtures,
    ...formattedResult,
  };
};

export type FixtureResolver = {
  cancelPendingFixtures: () => { teardownStarted: Promise<void> } | undefined;
  resolveTestFixtures: (fn?: (...args: any[]) => any) => Promise<void>;
  resolveHookFixtures: (
    fn: (...args: any[]) => any,
  ) => Promise<{ status: 'resolved' } | { status: 'skipped' }>;
};

class PreviouslyFailedFixtureError extends Error {}

type FixtureCallback = (...args: any[]) => any;

const callbackSources = new WeakMap<FixtureCallback, FixtureCallback>();
const fixturePropsCache = new WeakMap<
  FixtureCallback,
  { namedContext?: string[]; destructuredContext?: string[] }
>();

export function setFixtureCallbackSource(
  callback: (...args: any[]) => any,
  source: (...args: any[]) => any,
): void {
  callbackSources.set(callback, source);
}

export const createFixtureResolver = (
  test: TestCase,
  context: Record<string, any>,
  cleanups: (() => Promise<void>)[] = [],
): FixtureResolver => {
  if (!test.fixtures) {
    return {
      cancelPendingFixtures: () => undefined,
      resolveTestFixtures: () => Promise.resolve(),
      resolveHookFixtures: () => Promise.resolve({ status: 'resolved' }),
    };
  }

  const doneMap = new Set<string>();
  const cancelledFixtures = new Set<string>();
  const failedFixtures = new Set<string>();
  const pendingMap = new Set<string>();
  const cancelFixtureSetups = new Map<string, () => void>();
  const cancelledFixtureTeardownStarts = new Map<string, () => void>();

  const useFixture = async (
    name: string,
    NormalizedFixture: NormalizedFixture,
  ) => {
    if (doneMap.has(name)) {
      return;
    }
    if (failedFixtures.has(name)) {
      throw new PreviouslyFailedFixtureError(name);
    }
    if (pendingMap.has(name)) {
      throw new Error(`Circular fixture dependency: ${name}`);
    }

    const { isFn, deps, value: fixtureValue } = NormalizedFixture;
    if (!isFn) {
      context[name] = fixtureValue;
      doneMap.add(name);
      return;
    }

    pendingMap.add(name);
    try {
      if (deps?.length) {
        for (const dep of deps) {
          await useFixture(dep, test.fixtures![dep]!);
        }
      }

      // This API behavior follows Vitest & Playwright
      // but why not return cleanup function?
      await new Promise<void>((fixtureResolve, fixtureReject) => {
        let useDone: (() => void) | undefined;
        let blockSettled = false;
        cancelFixtureSetups.set(name, () => {
          if (blockSettled) {
            fixtureResolve();
          }
        });
        const block = Promise.resolve().then(() =>
          fixtureValue(context, async (value: any) => {
            if (cancelledFixtures.has(name)) {
              cancelledFixtureTeardownStarts.get(name)?.();
              return;
            }
            context[name] = value;
            cleanups.unshift(() => {
              useDone?.();
              return block;
            });
            fixtureResolve();
            return new Promise<void>((useFnResolve) => {
              useDone = useFnResolve;
            });
          }),
        );
        block.then(() => {
          blockSettled = true;
          if (cancelledFixtures.has(name)) {
            fixtureResolve();
          }
        }, fixtureReject);
      });

      if (cancelledFixtures.has(name)) {
        throw new PreviouslyFailedFixtureError(name);
      }
      doneMap.add(name);
    } catch (error) {
      failedFixtures.add(name);
      throw error;
    } finally {
      pendingMap.delete(name);
      cancelFixtureSetups.delete(name);
      cancelledFixtureTeardownStarts.delete(name);
    }
  };

  const resolveFixtureNames = async (
    usedKeys: string[],
    includeAuto: boolean,
  ) => {
    for (const [name, params] of Object.entries(test.fixtures ?? {})) {
      const shouldResolve =
        usedKeys.includes(name) || (includeAuto && params.options?.auto);
      if (!shouldResolve) {
        continue;
      }

      await useFixture(name, params);
    }
  };

  return {
    cancelPendingFixtures: () => {
      if (pendingMap.size === 0) {
        return undefined;
      }
      const teardownStarted = new Promise<void>((notifyTeardownStarted) => {
        for (const name of pendingMap) {
          cancelledFixtures.add(name);
          failedFixtures.add(name);
          cancelledFixtureTeardownStarts.set(name, notifyTeardownStarted);
          cancelFixtureSetups.get(name)?.();
        }
      });
      return { teardownStarted };
    },
    resolveTestFixtures: (fn) =>
      resolveFixtureNames(fn ? getFixtureUsedProps(fn) : [], true),
    resolveHookFixtures: async (fn) => {
      try {
        await resolveFixtureNames(getFixtureUsedProps(fn, true), false);
      } catch (error) {
        if (error instanceof PreviouslyFailedFixtureError) {
          return { status: 'skipped' };
        }
        throw error;
      }
      return { status: 'resolved' };
    },
  };
};

function splitByComma(s: string) {
  const filtered = filterOutNonCode(s);
  const result: string[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const char = filtered[i];
    if (char === '{' || char === '[' || char === '(') {
      stack.push(char === '{' ? '}' : char === '[' ? ']' : ')');
    } else if (char === stack[stack.length - 1]) {
      stack.pop();
    } else if (!stack.length && char === ',') {
      const token = s.substring(start, i).trim();
      if (token) result.push(token);
      start = i + 1;
    }
  }
  const lastToken = s.substring(start).trim();
  if (lastToken) result.push(lastToken);
  return result;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

function canStartRegex(text: readonly string[], index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(text[cursor]!)) {
    cursor--;
  }
  if (cursor < 0) {
    return true;
  }

  const previous = text[cursor]!;
  if ('([{=,:;!&|?+-*%^~<>'.includes(previous)) {
    return true;
  }
  if (!/[$\w]/.test(previous)) {
    return false;
  }

  const end = cursor + 1;
  while (cursor >= 0 && /[$\w]/.test(text[cursor]!)) {
    cursor--;
  }
  return REGEX_PREFIX_KEYWORDS.has(text.slice(cursor + 1, end).join(''));
}

function filterOutNonCode(s: string): string {
  const result = [...s];
  let commentState: 'none' | 'singleline' | 'multiline' = 'none';
  let quote: '"' | "'" | '`' | undefined;

  for (let i = 0; i < s.length; ++i) {
    const char = s[i]!;
    if (commentState === 'singleline') {
      if (char === '\n') {
        commentState = 'none';
      } else {
        result[i] = ' ';
      }
    } else if (commentState === 'multiline') {
      if (char === '*' && s[i + 1] === '/') {
        result[i] = ' ';
        result[i + 1] = ' ';
        commentState = 'none';
        i++;
      } else {
        result[i] = char === '\n' ? '\n' : ' ';
      }
    } else if (quote) {
      if (char === '\\') {
        result[i] = ' ';
        if (i + 1 < s.length) {
          i++;
          result[i] = s[i] === '\n' ? '\n' : ' ';
        }
      } else {
        if (char === quote) {
          quote = undefined;
        }
        result[i] = char === '\n' ? '\n' : ' ';
      }
    } else {
      if (char === '/' && s[i + 1] === '/') {
        result[i] = ' ';
        result[i + 1] = ' ';
        commentState = 'singleline';
        i++;
      } else if (char === '/' && s[i + 1] === '*') {
        result[i] = ' ';
        result[i + 1] = ' ';
        commentState = 'multiline';
        i++;
      } else if (char === '/' && canStartRegex(result, i)) {
        result[i] = ' ';
        let inCharacterClass = false;
        for (i++; i < s.length; i++) {
          const regexChar = s[i]!;
          result[i] = regexChar === '\n' ? '\n' : ' ';
          if (regexChar === '\\') {
            if (i + 1 < s.length) {
              i++;
              result[i] = s[i] === '\n' ? '\n' : ' ';
            }
          } else if (regexChar === '[') {
            inCharacterClass = true;
          } else if (regexChar === ']') {
            inCharacterClass = false;
          } else if (regexChar === '/' && !inCharacterClass) {
            while (i + 1 < s.length && /[A-Za-z]/.test(s[i + 1]!)) {
              i++;
              result[i] = ' ';
            }
            break;
          }
        }
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
        result[i] = ' ';
      }
    }
  }
  return result.join('');
}

function getDestructuredFixtureProps(param: string): string[] | undefined {
  if (param[0] !== '{' || !param.endsWith('}')) {
    return undefined;
  }

  const props = splitByComma(param.substring(1, param.length - 1)).map(
    (prop) => {
      const filtered = filterOutNonCode(prop);
      const stack: string[] = [];
      let separator = -1;
      for (let index = 0; index < filtered.length; index++) {
        const char = filtered[index];
        if (char === '{' || char === '[' || char === '(') {
          stack.push(char === '{' ? '}' : char === '[' ? ']' : ')');
        } else if (char === stack[stack.length - 1]) {
          stack.pop();
        } else if (!stack.length && (char === ':' || char === '=')) {
          separator = index;
          break;
        }
      }
      return separator === -1
        ? prop.trim()
        : prop.substring(0, separator).trim();
    },
  );
  return props;
}

function findClosingDelimiter(
  text: string,
  openingIndex: number,
  opening: string,
  closing: string,
): number | undefined {
  let depth = 0;
  for (let index = openingIndex; index < text.length; index++) {
    if (text[index] === opening) {
      depth++;
    } else if (text[index] === closing) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function findOpeningDelimiter(
  text: string,
  closingIndex: number,
  opening: string,
  closing: string,
): number | undefined {
  let depth = 0;
  for (let index = closingIndex; index >= 0; index--) {
    if (text[index] === closing) {
      depth++;
    } else if (text[index] === opening) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index]!)) {
    index++;
  }
  return index;
}

function skipWhitespaceBackwards(text: string, start: number): number {
  let index = start;
  while (index >= 0 && /\s/.test(text[index]!)) {
    index--;
  }
  return index;
}

function isWordAt(text: string, index: number, word: string): boolean {
  return (
    text.startsWith(word, index) &&
    !/[$\w]/.test(text[index - 1] ?? '') &&
    !/[$\w]/.test(text[index + word.length] ?? '')
  );
}

function getPreviousWord(text: string, start: number): string {
  let cursor = skipWhitespaceBackwards(text, start);
  const end = cursor + 1;
  while (cursor >= 0 && /[$\w]/.test(text[cursor]!)) {
    cursor--;
  }
  return text.slice(cursor + 1, end);
}

function findExpressionEnd(
  text: string,
  expressionStart: number,
  bodyEnd: number,
): number {
  const stack: string[] = [];
  for (let index = expressionStart; index < bodyEnd; index++) {
    const char = text[index];
    if (char === '{' || char === '[' || char === '(') {
      stack.push(char === '{' ? '}' : char === '[' ? ']' : ')');
    } else if (char === stack[stack.length - 1]) {
      stack.pop();
    } else if (!stack.length && (char === ',' || char === ';')) {
      return index - 1;
    } else if (!stack.length && char === '\n') {
      const nextLine = text.slice(skipWhitespace(text, index + 1));
      if (
        /^(?:class|const|for|function|if|let|return|switch|throw|try|var|while)\b/.test(
          nextLine,
        )
      ) {
        return index - 1;
      }
    }
  }
  return bodyEnd - 1;
}

function getNestedFunctionRanges(
  text: string,
  bodyStart: number,
  bodyEnd: number,
): [number, number][] {
  const ranges: [number, number][] = [];
  const controlKeywords = new Set([
    'catch',
    'for',
    'if',
    'switch',
    'while',
    'with',
  ]);

  for (let index = bodyStart + 1; index < bodyEnd; index++) {
    if (isWordAt(text, index, 'function')) {
      const paramsStart = text.indexOf('(', index + 'function'.length);
      if (paramsStart === -1 || paramsStart >= bodyEnd) {
        continue;
      }
      const paramsEnd = findClosingDelimiter(text, paramsStart, '(', ')');
      const nestedBodyStart =
        paramsEnd === undefined ? bodyEnd : skipWhitespace(text, paramsEnd + 1);
      if (text[nestedBodyStart] !== '{') {
        continue;
      }
      const nestedBodyEnd = findClosingDelimiter(
        text,
        nestedBodyStart,
        '{',
        '}',
      );
      if (nestedBodyEnd !== undefined && nestedBodyEnd <= bodyEnd) {
        ranges.push([nestedBodyStart, nestedBodyEnd]);
        index = nestedBodyEnd;
      }
      continue;
    }

    if (text[index] === '=' && text[index + 1] === '>') {
      const nestedBodyStart = skipWhitespace(text, index + 2);
      const nestedBodyEnd =
        text[nestedBodyStart] === '{'
          ? findClosingDelimiter(text, nestedBodyStart, '{', '}')
          : findExpressionEnd(text, nestedBodyStart, bodyEnd);
      if (nestedBodyEnd !== undefined && nestedBodyEnd <= bodyEnd) {
        ranges.push([nestedBodyStart, nestedBodyEnd]);
        index = nestedBodyEnd;
      }
      continue;
    }

    if (text[index] !== '{') {
      continue;
    }
    const paramsEnd = skipWhitespaceBackwards(text, index - 1);
    if (text[paramsEnd] !== ')') {
      continue;
    }
    const paramsStart = findOpeningDelimiter(text, paramsEnd, '(', ')');
    if (paramsStart === undefined) {
      continue;
    }
    const previousWord = getPreviousWord(text, paramsStart - 1);
    if (controlKeywords.has(previousWord)) {
      continue;
    }
    const nestedBodyEnd = findClosingDelimiter(text, index, '{', '}');
    if (nestedBodyEnd !== undefined && nestedBodyEnd <= bodyEnd) {
      ranges.push([index, nestedBodyEnd]);
      index = nestedBodyEnd;
    }
  }

  return ranges;
}

function getCallbackParams(
  text: string,
): { params: string; signatureEnd: number } | undefined {
  const singleParamMatch = /^(?:async\s+)?([$A-Z_a-z][$\w]*)\s*=>/.exec(text);
  if (singleParamMatch) {
    return {
      params: singleParamMatch[1]!,
      signatureEnd: singleParamMatch[0].length,
    };
  }

  const paramsStart = text.indexOf('(');
  if (paramsStart === -1) {
    return undefined;
  }
  const paramsEnd = findClosingDelimiter(text, paramsStart, '(', ')');
  if (paramsEnd === undefined) {
    return undefined;
  }
  return {
    params: text.slice(paramsStart + 1, paramsEnd),
    signatureEnd: paramsEnd + 1,
  };
}

function isContextAssignment(
  text: string,
  closingIndex: number,
  param: string,
): boolean {
  let cursor = skipWhitespace(text, closingIndex + 1);
  if (text[cursor] !== '=') {
    return false;
  }
  cursor = skipWhitespace(text, cursor + 1);
  if (!text.startsWith(param, cursor)) {
    return false;
  }
  const next = text[cursor + param.length];
  if (/[$\w]/.test(next ?? '')) {
    return false;
  }
  const memberStart = skipWhitespace(text, cursor + param.length);
  return !(
    text[memberStart] === '.' ||
    text[memberStart] === '[' ||
    text.startsWith('?.', memberStart)
  );
}

function getNamedContextFixtureProps(
  text: string,
  param: string,
  signatureEnd: number,
): string[] {
  let bodyStart = skipWhitespace(text, signatureEnd);
  if (text.startsWith('=>', bodyStart)) {
    bodyStart = skipWhitespace(text, bodyStart + 2);
  }
  if (text[bodyStart] !== '{') {
    return [];
  }
  const bodyEnd = findClosingDelimiter(text, bodyStart, '{', '}');
  if (bodyEnd === undefined) {
    return [];
  }

  const nestedFunctionRanges = getNestedFunctionRanges(
    text,
    bodyStart,
    bodyEnd,
  );
  const props = new Set<string>();
  let rangeIndex = 0;

  for (let index = bodyStart + 1; index < bodyEnd; index++) {
    while (
      nestedFunctionRanges[rangeIndex] &&
      index > nestedFunctionRanges[rangeIndex]![1]
    ) {
      rangeIndex++;
    }
    const nestedRange = nestedFunctionRanges[rangeIndex];
    if (nestedRange && index >= nestedRange[0]) {
      index = nestedRange[1];
      rangeIndex++;
      continue;
    }
    if (text[index] !== '{') {
      continue;
    }
    const closingIndex = findClosingDelimiter(text, index, '{', '}');
    if (closingIndex === undefined || closingIndex > bodyEnd) {
      break;
    }
    if (!isContextAssignment(text, closingIndex, param)) {
      continue;
    }

    const destructuredProps =
      getDestructuredFixtureProps(text.slice(index, closingIndex + 1)) ?? [];
    assertNoRestProperty(destructuredProps);
    for (const prop of destructuredProps) {
      props.add(prop);
    }
    index = closingIndex;
  }

  return [...props];
}

function getFixtureCallbackSource(fn: FixtureCallback): FixtureCallback {
  const seen = new Set<FixtureCallback>();
  let source = fn;
  while (callbackSources.has(source) && !seen.has(source)) {
    seen.add(source);
    source = callbackSources.get(source)!;
  }
  return source;
}

function assertNoRestProperty(props: string[]): void {
  const restProperty = props.find((prop) => prop.startsWith('...'));
  if (restProperty) {
    throw new Error(
      `Rest property "${restProperty}" is not supported. List all used fixtures explicitly, separated by comma.`,
    );
  }
}

function parseFixtureUsedProps(
  fn: (...args: any[]) => any,
  allowNamedContext: boolean,
): string[] {
  const text = filterOutNonCode(fn.toString()).trim();
  const signature = getCallbackParams(text);
  if (!signature) {
    return [];
  }
  const trimmedParams = signature.params.trim();
  if (!trimmedParams) {
    return [];
  }
  const [firstParam] = splitByComma(trimmedParams);
  const props = getDestructuredFixtureProps(firstParam ?? '');
  if (props) {
    assertNoRestProperty(props);
    return props;
  }

  if (/^[$A-Z_a-z][$\w]*$/.test(firstParam ?? '')) {
    const transformedProps = getNamedContextFixtureProps(
      text,
      firstParam!,
      signature.signatureEnd,
    );
    if (transformedProps.length) {
      return transformedProps;
    }
    if (firstParam!.startsWith('_') || allowNamedContext) {
      return [];
    }
  }

  throw new Error(
    `First argument must use the object destructuring pattern: ${firstParam}`,
  );
}

/**
 * This method is modified based on source found in
 * https://github.com/microsoft/playwright/blob/3584e722237488c07dd23bbf12966f5509bf25c6/packages/playwright/src/common/fixtures.ts#L272
 *
 * Portions Copyright (c) Microsoft Corporation.
 * Portions Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function getFixtureUsedProps(
  fn: (...args: any[]) => any,
  allowNamedContext = false,
): string[] {
  const source = getFixtureCallbackSource(fn);
  let cached = fixturePropsCache.get(source);
  const cacheKey = allowNamedContext ? 'namedContext' : 'destructuredContext';
  if (cached?.[cacheKey]) {
    return cached[cacheKey]!;
  }

  const props = parseFixtureUsedProps(
    source as (...args: any[]) => any,
    allowNamedContext,
  );
  cached ??= {};
  cached[cacheKey] = props;
  fixturePropsCache.set(source, cached);
  return props;
}
