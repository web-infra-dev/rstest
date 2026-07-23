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

function splitByComma(s: string): string[] {
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
      if (token) {
        result.push(token);
      }
      start = i + 1;
    }
  }
  const lastToken = s.substring(start).trim();
  if (lastToken) {
    result.push(lastToken);
  }
  return result;
}

function filterOutComments(s: string): string {
  const result: string[] = [];
  let commentState: 'none' | 'singleline' | 'multiline' = 'none';
  for (let i = 0; i < s.length; ++i) {
    if (commentState === 'singleline') {
      if (s[i] === '\n') {
        commentState = 'none';
      }
    } else if (commentState === 'multiline') {
      if (s[i - 1] === '*' && s[i] === '/') {
        commentState = 'none';
      }
    } else if (s[i] === '/' && s[i + 1] === '/') {
      commentState = 'singleline';
    } else if (s[i] === '/' && s[i + 1] === '*') {
      commentState = 'multiline';
      i += 2;
    } else {
      result.push(s[i]!);
    }
  }
  return result.join('');
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

function fixtureParamError(firstParam: string | undefined): Error {
  return new Error(
    `First argument must use the object destructuring pattern: ${firstParam}`,
  );
}

function parseFixtureUsedProps(
  fn: FixtureCallback,
  allowNamedContext: boolean,
): string[] {
  const text = filterOutComments(fn.toString()).trim();
  const singleParamArrow = /^(?:async\s+)?([$A-Z_a-z][$\w]*)\s*=>/.exec(text);
  if (singleParamArrow) {
    const firstParam = singleParamArrow[1];
    if (allowNamedContext || firstParam?.startsWith('_')) {
      return [];
    }
    throw fixtureParamError(firstParam);
  }

  const match = /(?:async)?(?:\s+function)?[^(]*\(([^)]*)/.exec(text);
  if (!match) {
    return [];
  }
  const trimmedParams = match[1]!.trim();
  if (!trimmedParams) {
    return [];
  }

  const [firstParam] = splitByComma(trimmedParams);
  if (firstParam?.[0] !== '{' || !firstParam.endsWith('}')) {
    if (allowNamedContext || firstParam?.startsWith('_')) {
      return [];
    }
    throw fixtureParamError(firstParam);
  }
  if (/}\s*=/.test(firstParam)) {
    throw new Error(
      `Default values are not supported for the fixture context: ${firstParam}`,
    );
  }

  const props = splitByComma(
    firstParam.substring(1, firstParam.length - 1),
  ).map((prop) => {
    if (prop.includes('=')) {
      throw new Error(
        `Default values are not supported in fixture destructuring: ${prop}`,
      );
    }
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
