import type {
  FixtureOptions,
  FixtureScope,
  Fixtures,
  NormalizedFixture,
  NormalizedFixtures,
  ScopedFixtureFn,
  TestCase,
} from '../../types';
import { isObject } from '../../utils/helper';

const SCOPE_ORDER: FixtureScope[] = ['test', 'file'];

/**
 * Per-file fixture state: caches resolved values for `scope: 'file'` fixtures
 * and collects cleanup handlers to flush after all tests in the file complete.
 */
export interface FileFixtureStore {
  /** Resolved file-scoped fixture values, keyed by fixture name. */
  cache: Map<string, unknown>;
  /** In-flight setup promises, used to dedupe concurrent first-time accesses. */
  pending: Map<string, Promise<unknown>>;
  /** Cleanup handlers, drained in LIFO order at file teardown. */
  cleanups: Array<() => void | Promise<void>>;
}

export const createFileFixtureStore = (): FileFixtureStore => ({
  cache: new Map(),
  pending: new Map(),
  cleanups: [],
});

const assertScope = (scope: unknown, fixtureName: string): FixtureScope => {
  if (scope === undefined) {
    return 'test';
  }
  if (scope === 'test' || scope === 'file') {
    return scope;
  }
  if (scope === 'worker') {
    throw new Error(
      `Unsupported fixture scope "worker" on "${fixtureName}". rstest currently supports "test" (default) and "file".`,
    );
  }
  throw new Error(
    `Unsupported fixture scope "${String(scope)}" on "${fixtureName}". rstest only supports "test" and "file".`,
  );
};

export const normalizeFixtures = (
  fixtures: Fixtures = {},
  extendFixtures: NormalizedFixtures = {},
): NormalizedFixtures => {
  const result: NormalizedFixtures = {};
  for (const key in fixtures) {
    const fixtureOptionKeys = ['auto', 'scope'];
    // @ts-expect-error
    const value = fixtures[key]!;
    if (Array.isArray(value)) {
      if (value.length === 1 && typeof value[0] === 'function') {
        result[key] = {
          isFn: true,
          value: value[0],
          scope: 'test',
          style: 'use-callback',
        };
        continue;
      }
      if (
        isObject(value[1]) &&
        Object.keys(value[1]).some((k) => fixtureOptionKeys.includes(k))
      ) {
        const options = value[1] as FixtureOptions;
        result[key] = {
          isFn: typeof value[0] === 'function',
          value: value[0],
          options,
          scope: assertScope(options.scope, key),
          style: 'use-callback',
        };
        continue;
      }
    }
    result[key] = {
      isFn: typeof value === 'function',
      value,
      scope: 'test',
      style: 'use-callback',
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

  const merged: NormalizedFixtures = {
    ...extendFixtures,
    ...formattedResult,
  };

  validateFixtureScopes(merged);

  return merged;
};

/**
 * Normalize a builder-style fixture (`extend(name, opts?, fn)`) and merge it
 * into the existing fixture map. Returns the merged map.
 */
export const normalizeBuilderFixture = (
  name: string,
  options: FixtureOptions | undefined,
  fn: ScopedFixtureFn<unknown, any>,
  extendFixtures: NormalizedFixtures = {},
): NormalizedFixtures => {
  if (typeof fn !== 'function') {
    throw new Error(
      `Fixture "${name}" must be a function when using the builder syntax \`extend(name, ...)\`.`,
    );
  }
  const scope = assertScope(options?.scope, name);
  const usedProps = getFixtureUsedProps(fn);
  const entry: NormalizedFixture = {
    isFn: true,
    value: fn,
    options,
    scope,
    style: 'return',
    deps: usedProps.filter((p) => p === name || p in extendFixtures),
  };
  const merged: NormalizedFixtures = {
    ...extendFixtures,
    [name]: entry,
  };
  validateFixtureScopes(merged);
  return merged;
};

/**
 * Verify that no fixture depends on a fixture with a shorter (more frequently
 * torn down) lifetime — e.g. a `file` fixture cannot consume a `test` fixture.
 */
export const validateFixtureScopes = (fixtures: NormalizedFixtures): void => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    if (!fixture.deps?.length) continue;
    for (const dep of fixture.deps) {
      const depFixture = fixtures[dep];
      if (!depFixture) continue;
      if (
        SCOPE_ORDER.indexOf(fixture.scope) >
        SCOPE_ORDER.indexOf(depFixture.scope)
      ) {
        throw new Error(
          `Fixture "${name}" (${fixture.scope} scope) cannot depend on "${dep}" (${depFixture.scope} scope). ` +
            `A ${fixture.scope}-scoped fixture outlives its ${depFixture.scope}-scoped dependency, ` +
            `so the dependency's value would be torn down while still in use.`,
        );
      }
    }
  }
};

export const handleFixtures = async (
  test: TestCase,
  context: Record<string, any>,
  fileFixtureStore: FileFixtureStore,
): Promise<{
  cleanups: (() => Promise<void>)[];
}> => {
  const testCleanups: (() => Promise<void>)[] = [];

  if (!test.fixtures) {
    return { cleanups: testCleanups };
  }

  const doneMap = new Set<string>();
  const pendingMap = new Set<string>();

  const usedKeys: string[] = test.originalFn
    ? getFixtureUsedProps(test.originalFn)
    : [];

  const useFixture = async (
    name: string,
    fixture: NormalizedFixture,
  ): Promise<void> => {
    if (doneMap.has(name)) {
      return;
    }
    if (pendingMap.has(name)) {
      throw new Error(`Circular fixture dependency: ${name}`);
    }

    // File scope: serve from cache if already resolved.
    if (fixture.scope === 'file' && fileFixtureStore.cache.has(name)) {
      context[name] = fileFixtureStore.cache.get(name);
      doneMap.add(name);
      return;
    }

    // File scope: piggyback on in-flight resolution by another concurrent test.
    if (fixture.scope === 'file' && fileFixtureStore.pending.has(name)) {
      const value = await fileFixtureStore.pending.get(name)!;
      context[name] = value;
      doneMap.add(name);
      return;
    }

    const { isFn, deps, value: fixtureValue } = fixture;
    if (!isFn) {
      context[name] = fixtureValue;
      if (fixture.scope === 'file') {
        fileFixtureStore.cache.set(name, fixtureValue);
      }
      doneMap.add(name);
      return;
    }

    pendingMap.add(name);

    if (deps?.length) {
      for (const dep of deps) {
        await useFixture(dep, test.fixtures![dep]!);
      }
    }

    let resolveSetup: ((value: unknown) => void) | undefined;
    let rejectSetup: ((err: unknown) => void) | undefined;
    if (fixture.scope === 'file') {
      const setupPromise = new Promise<unknown>((resolve, reject) => {
        resolveSetup = resolve;
        rejectSetup = reject;
      });
      fileFixtureStore.pending.set(name, setupPromise);
      // Suppress unhandled-rejection noise; concurrent waiters attach later.
      setupPromise.catch(() => {});
    }

    try {
      if (fixture.style === 'return') {
        const onCleanupHandlers: Array<() => void | Promise<void>> = [];
        const helpers = {
          onCleanup: (handler: () => void | Promise<void>) => {
            onCleanupHandlers.push(handler);
          },
        };
        const value = await fixtureValue(context, helpers);
        context[name] = value;

        // Test cleanups run in array order; file cleanups are reversed at
        // flush time. unshift vs push selected so both paths end up LIFO.
        if (fixture.scope === 'file') {
          fileFixtureStore.cache.set(name, value);
          fileFixtureStore.cleanups.push(...onCleanupHandlers);
        } else {
          for (const fn of onCleanupHandlers) {
            testCleanups.unshift(async () => {
              await fn();
            });
          }
        }
        resolveSetup?.(value);
      } else {
        // use-callback style: the fixture body suspends at `await use(value)`;
        // the suspended block becomes the cleanup.
        await new Promise<void>((fixtureResolve, fixtureReject) => {
          let useDone: (() => void) | undefined;
          let useStarted = false;
          const block = fixtureValue(context, async (value: any) => {
            useStarted = true;
            context[name] = value;
            if (fixture.scope === 'file') {
              fileFixtureStore.cache.set(name, value);
            }
            fixtureResolve();
            resolveSetup?.(value);
            return new Promise<void>((useFnResolve) => {
              useDone = useFnResolve;
            });
          });

          const cleanupFn = async () => {
            useDone?.();
            await block;
          };
          if (fixture.scope === 'file') {
            fileFixtureStore.cleanups.push(cleanupFn);
          } else {
            testCleanups.unshift(cleanupFn);
          }

          Promise.resolve(block).then(
            () => {
              if (!useStarted) {
                fixtureReject(
                  new Error(
                    `Fixture "${name}" finished without calling \`use\`. ` +
                      `A use-callback fixture must call \`await use(value)\` exactly once.`,
                  ),
                );
              }
            },
            (err) => {
              if (!useStarted) {
                fixtureReject(err);
              }
              // After use has started, the error belongs to the cleanup phase
              // and is surfaced when the cleanup awaits `block`.
            },
          );
        });
      }
    } catch (err) {
      // Propagate setup failure to concurrent waiters on the pending promise
      // and to the outer caller (which will fail the originating test).
      if (fixture.scope === 'file') {
        rejectSetup?.(err);
      }
      throw err;
    } finally {
      if (fixture.scope === 'file') {
        fileFixtureStore.pending.delete(name);
      }
    }

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

  return { cleanups: testCleanups };
};

/**
 * Drain accumulated file-scoped cleanup handlers in LIFO order.
 * Errors from individual handlers are collected and re-thrown together so
 * one bad cleanup does not skip the others.
 */
export const flushFileFixtures = async (
  store: FileFixtureStore,
): Promise<Error[]> => {
  const errors: Error[] = [];
  const cleanups = store.cleanups.splice(0).reverse();
  for (const fn of cleanups) {
    try {
      await fn();
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  store.cache.clear();
  store.pending.clear();
  return errors;
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
function getFixtureUsedProps(fn: (...args: any[]) => any): string[] {
  const text = filterOutComments(fn.toString());
  const match = /(?:async)?(?:\s+function)?[^(]*\(([^)]*)/.exec(text);
  if (!match) return [];
  const trimmedParams = match[1]!.trim();
  if (!trimmedParams) return [];
  const [firstParam] = splitByComma(trimmedParams);
  if (firstParam?.[0] !== '{' || !firstParam.endsWith('}')) {
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
