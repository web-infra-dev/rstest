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
  resolveTestFixtures: (fn?: (...args: any[]) => any) => Promise<void>;
  resolveHookFixtures: (fn: (...args: any[]) => any) => Promise<void | false>;
};

class PreviouslyFailedFixtureError extends Error {}

export const createFixtureResolver = (
  test: TestCase,
  context: Record<string, any>,
  cleanups: (() => Promise<void>)[] = [],
): FixtureResolver => {
  if (!test.fixtures) {
    return {
      resolveTestFixtures: () => Promise.resolve(),
      resolveHookFixtures: () => Promise.resolve(),
    };
  }

  const doneMap = new Set<string>();
  const failedFixtures = new Set<string>();
  const pendingMap = new Set<string>();

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
        const block = Promise.resolve().then(() =>
          fixtureValue(context, async (value: any) => {
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
        block.catch(fixtureReject);
      });

      doneMap.add(name);
    } catch (error) {
      failedFixtures.add(name);
      throw error;
    } finally {
      pendingMap.delete(name);
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
    resolveTestFixtures: (fn) =>
      resolveFixtureNames(fn ? getFixtureUsedProps(fn) : [], true),
    resolveHookFixtures: async (fn) => {
      try {
        await resolveFixtureNames(getFixtureUsedProps(fn, true), false);
      } catch (error) {
        if (error instanceof PreviouslyFailedFixtureError) {
          return false;
        }
        throw error;
      }
      return undefined;
    },
  };
};

function splitByComma(s: string) {
  const result: string[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[') {
      stack.push(s[i] === '{' ? '}' : ']');
    } else if (s[i] === stack[stack.length - 1]) {
      stack.pop();
    } else if (!stack.length && s[i] === ',') {
      const token = s.substring(start, i).trim();
      if (token) result.push(token);
      start = i + 1;
    }
  }
  const lastToken = s.substring(start).trim();
  if (lastToken) result.push(lastToken);
  return result;
}

function filterOutComments(s: string): string {
  const result: string[] = [];
  let commentState: 'none' | 'singleline' | 'multiline' = 'none';
  for (let i = 0; i < s.length; ++i) {
    if (commentState === 'singleline') {
      if (s[i] === '\n') commentState = 'none';
    } else if (commentState === 'multiline') {
      if (s[i - 1] === '*' && s[i] === '/') commentState = 'none';
    } else if (commentState === 'none') {
      if (s[i] === '/' && s[i + 1] === '/') {
        commentState = 'singleline';
      } else if (s[i] === '/' && s[i + 1] === '*') {
        commentState = 'multiline';
        i += 2;
      } else {
        result.push(s[i]!);
      }
    }
  }
  return result.join('');
}

function filterOutStrings(s: string): string {
  const result: string[] = [];
  let quote: '"' | "'" | '`' | undefined;

  for (let i = 0; i < s.length; i++) {
    const char = s[i]!;
    if (quote) {
      if (char === '\\') {
        result.push(' ', ' ');
        i++;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      result.push(char === '\n' ? '\n' : ' ');
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      result.push(' ');
      continue;
    }

    result.push(char);
  }

  return result.join('');
}

function getDestructuredFixtureProps(param: string): string[] | undefined {
  if (param[0] !== '{' || !param.endsWith('}')) {
    return undefined;
  }

  const props = splitByComma(param.substring(1, param.length - 1)).map(
    (prop) => {
      const colon = prop.indexOf(':');
      const equals = prop.indexOf('=');
      let separator = colon;
      if (separator === -1 || (equals !== -1 && equals < separator)) {
        separator = equals;
      }
      return separator === -1
        ? prop.trim()
        : prop.substring(0, separator).trim();
    },
  );
  const restProperty = props.find((prop) => prop.startsWith('...'));
  if (restProperty) {
    throw new Error(
      `Rest property "${restProperty}" is not supported. List all used fixtures explicitly, separated by comma.`,
    );
  }
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

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index]!)) {
    index++;
  }
  return index;
}

function getNestedFunctionRanges(
  text: string,
  bodyStart: number,
  bodyEnd: number,
): [number, number][] {
  const ranges: [number, number][] = [];
  const addBodyRange = (openingIndex: number) => {
    const closingIndex = findClosingDelimiter(text, openingIndex, '{', '}');
    if (closingIndex !== undefined && closingIndex <= bodyEnd) {
      ranges.push([openingIndex, closingIndex]);
      return closingIndex;
    }
    return openingIndex;
  };

  const arrowPattern = /=>\s*\{/g;
  arrowPattern.lastIndex = bodyStart + 1;
  let arrowMatch: RegExpExecArray | null;
  while ((arrowMatch = arrowPattern.exec(text))) {
    if (arrowMatch.index >= bodyEnd) {
      break;
    }
    const openingIndex = arrowMatch.index + arrowMatch[0].lastIndexOf('{');
    arrowPattern.lastIndex = addBodyRange(openingIndex) + 1;
  }

  const functionPattern = /\bfunction\b/g;
  functionPattern.lastIndex = bodyStart + 1;
  let functionMatch: RegExpExecArray | null;
  while ((functionMatch = functionPattern.exec(text))) {
    if (functionMatch.index >= bodyEnd) {
      break;
    }
    let cursor = skipWhitespace(
      text,
      functionMatch.index + functionMatch[0].length,
    );
    if (text[cursor] === '*') {
      cursor = skipWhitespace(text, cursor + 1);
    }
    const nameMatch = /^[$A-Z_a-z][$\w]*/.exec(text.slice(cursor));
    if (nameMatch) {
      cursor = skipWhitespace(text, cursor + nameMatch[0].length);
    }
    if (text[cursor] !== '(') {
      continue;
    }
    const paramsEnd = findClosingDelimiter(text, cursor, '(', ')');
    if (paramsEnd === undefined) {
      continue;
    }
    const openingIndex = skipWhitespace(text, paramsEnd + 1);
    if (text[openingIndex] === '{') {
      functionPattern.lastIndex = addBodyRange(openingIndex) + 1;
    }
  }

  return ranges;
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
  const escapedParam = param.replaceAll('$', '\\$');
  const assignmentPattern = new RegExp(`^\\s*=\\s*${escapedParam}(?![$\\w])`);
  const declarationPattern = /\b(?:const|let|var)\s*\{/g;
  declarationPattern.lastIndex = bodyStart + 1;
  const props = new Set<string>();

  let declarationMatch: RegExpExecArray | null;
  while ((declarationMatch = declarationPattern.exec(text))) {
    if (declarationMatch.index >= bodyEnd) {
      break;
    }
    const declarationIndex = declarationMatch.index;
    const nestedRange = nestedFunctionRanges.find(
      ([start, end]) => declarationIndex > start && declarationIndex < end,
    );
    if (nestedRange) {
      declarationPattern.lastIndex = nestedRange[1] + 1;
      continue;
    }

    const openingIndex =
      declarationIndex + declarationMatch[0].lastIndexOf('{');
    const closingIndex = findClosingDelimiter(text, openingIndex, '{', '}');
    if (closingIndex === undefined || closingIndex > bodyEnd) {
      break;
    }
    declarationPattern.lastIndex = closingIndex + 1;
    if (!assignmentPattern.test(text.slice(closingIndex + 1, bodyEnd + 1))) {
      continue;
    }

    for (const prop of getDestructuredFixtureProps(
      text.slice(openingIndex, closingIndex + 1),
    ) ?? []) {
      props.add(prop);
    }
  }

  return [...props];
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
  const text = filterOutComments(filterOutStrings(fn.toString())).trim();
  const parenthesizedMatch =
    /^(?:async\s+)?(?:function(?:\s+[$A-Z_a-z][$\w]*)?\s*|[$A-Z_a-z][$\w]*\s*)?\(([^)]*)\)/.exec(
      text,
    );
  const singleParamMatch = parenthesizedMatch
    ? undefined
    : /^(?:async\s+)?([$A-Z_a-z][$\w]*)\s*=>/.exec(text);
  const params = parenthesizedMatch?.[1] ?? singleParamMatch?.[1];
  if (params === undefined) return [];
  const trimmedParams = params.trim();
  if (!trimmedParams) return [];
  const [firstParam] = splitByComma(trimmedParams);
  const props = getDestructuredFixtureProps(firstParam ?? '');
  if (props) {
    return props;
  }

  if (firstParam?.startsWith('_')) {
    return [];
  }

  if (/^[$A-Z_a-z][$\w]*$/.test(firstParam ?? '')) {
    const signatureEnd =
      parenthesizedMatch?.[0].length ?? singleParamMatch?.[0].length;
    if (signatureEnd !== undefined) {
      const transformedProps = getNamedContextFixtureProps(
        text,
        firstParam!,
        signatureEnd,
      );
      if (transformedProps.length) {
        return transformedProps;
      }
    }
    if (allowNamedContext) {
      return [];
    }
  }

  throw new Error(
    `First argument must use the object destructuring pattern: ${firstParam}`,
  );
}
