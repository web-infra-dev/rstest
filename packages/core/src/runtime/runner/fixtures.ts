import type {
  Fixtures,
  NormalizedFixture,
  NormalizedFixtures,
  TestCase,
} from '../../types';
import { isObject } from '../../utils';

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

export const handleFixtures = async (
  test: TestCase,
  context: Record<string, any>,
): Promise<{
  cleanups: (() => Promise<void>)[];
}> => {
  const cleanups: (() => Promise<void>)[] = [];

  if (!test.fixtures) {
    return { cleanups };
  }

  const doneMap = new Set<string>();
  const pendingMap = new Set<string>();

  const usedKeys: string[] = test.originalFn
    ? getFixtureUsedProps(test.originalFn)
    : [];

  const useFixture = async (
    name: string,
    NormalizedFixture: NormalizedFixture,
  ) => {
    if (doneMap.has(name)) {
      return;
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

    if (deps?.length) {
      for (const dep of deps) {
        await useFixture(dep, test.fixtures![dep]!);
      }
    }

    // This API behavior follows vitest & playwright
    // but why not return cleanup function?
    await new Promise<void>((fixtureResolve) => {
      let useDone: (() => void) | undefined;
      const block = fixtureValue(context, async (value: any) => {
        context[name] = value;
        fixtureResolve();
        return new Promise<void>((useFnResolve) => {
          useDone = useFnResolve;
        });
      });

      cleanups.unshift(() => {
        useDone?.();
        return block;
      });
    });

    doneMap.add(name);
    pendingMap.delete(name);
  };

  for (const [name, params] of Object.entries(test.fixtures)) {
    // call fixture on demand
    const shouldAdd = params.options?.auto || usedKeys.includes(name);
    if (!shouldAdd) {
      continue;
    }

    await useFixture(name, params);
  }

  return { cleanups };
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
// biome-ignore lint/complexity/noBannedTypes: Function type
export function getFixtureUsedProps(fn: Function): string[] {
  const text = filterOutComments(fn.toString());
  const match = text.match(/(?:async)?(?:\s+function)?[^(]*\(([^)]*)/);
  if (!match) return [];
  const trimmedParams = match[1]!.trim();
  if (!trimmedParams) return [];
  const [firstParam] = splitByComma(trimmedParams);
  if (firstParam?.[0] !== '{' || firstParam[firstParam.length - 1] !== '}') {
    if (firstParam?.startsWith('_')) {
      return [];
    }
    throw new Error(
      `First argument must use the object destructuring pattern: ${firstParam}`,
    );
  }
  const props = splitByComma(
    firstParam.substring(1, firstParam.length - 1),
  ).map((prop) => {
    const colon = prop.indexOf(':');
    return colon === -1 ? prop.trim() : prop.substring(0, colon).trim();
  });
  const restProperty = props.find((prop) => prop.startsWith('...'));
  if (restProperty) {
    throw new Error(
      `Rest property "${restProperty}" is not supported. List all used fixtures explicitly, separated by comma.`,
    );
  }
  return props;
}
