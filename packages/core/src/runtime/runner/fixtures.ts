import type {
  FixtureCleanup,
  FixtureOptions,
  FixtureScope,
  Fixtures,
  NormalizedFixture,
  NormalizedFixtures,
  TestCase,
} from '../../types';
import { isObject } from '../../utils/helper';

const fixtureOptionKeys = ['auto'];
const fixtureScopes: FixtureScope[] = ['worker', 'file', 'test'];

const resolveFixtureOptions = (
  name: string,
  options: FixtureOptions | undefined,
  parent: NormalizedFixture | undefined,
): NormalizedFixture['options'] => {
  const parentOptions = parent?.options ?? {
    auto: false,
    scope: 'test',
  };
  if (parentOptions.scope !== 'test') {
    throw new Error(
      `The ${parentOptions.scope} fixture "${name}" cannot be overridden.`,
    );
  }
  if (!options && parent) {
    return parentOptions;
  }

  const resolved = {
    auto: options?.auto ?? false,
    scope: options?.scope ?? 'test',
  };

  if (!fixtureScopes.includes(resolved.scope)) {
    throw new Error(
      `Fixture "${name}" has unknown scope "${String(resolved.scope)}".`,
    );
  }
  if (resolved.scope !== 'test' && options && Object.hasOwn(options, 'auto')) {
    throw new Error(
      `The ${resolved.scope} fixture "${name}" does not support auto setup.`,
    );
  }
  if (parent && parentOptions.scope !== resolved.scope) {
    throw new Error(
      `Fixture "${name}" was already registered with "${parentOptions.scope}" scope.`,
    );
  }
  if (parent && parentOptions.auto !== resolved.auto) {
    throw new Error(
      `Fixture "${name}" was already registered with auto: ${parentOptions.auto}.`,
    );
  }

  return resolved;
};

const finalizeFixtures = (
  fixtures: NormalizedFixtures,
  names: string[],
): NormalizedFixtures => {
  for (const name of names) {
    const fixture = fixtures[name]!;
    if (!fixture.isFn) {
      continue;
    }

    const usedProps = getFixtureUsedProps(fixture.value);
    const deps = usedProps.filter((property) =>
      Object.hasOwn(fixtures, property),
    );

    for (const property of usedProps) {
      const dependency = fixtures[property];
      if (!dependency) {
        if (fixture.options.scope !== 'test') {
          throw new Error(
            `The ${fixture.options.scope} fixture "${name}" cannot depend on test context "${property}".`,
          );
        }
        continue;
      }

      if (
        fixtureScopes.indexOf(fixture.options.scope) <
        fixtureScopes.indexOf(dependency.options.scope)
      ) {
        throw new Error(
          `The ${fixture.options.scope} fixture "${name}" cannot depend on the ${dependency.options.scope} fixture "${property}".`,
        );
      }
    }

    const previousDeps = fixture.deps;
    if (
      !previousDeps ||
      previousDeps.length !== deps.length ||
      previousDeps.some((dependency, index) => dependency !== deps[index])
    ) {
      fixtures[name] = { ...fixture, deps };
    }
  }

  return fixtures;
};

export const normalizeFixtures = (
  fixtures: Fixtures = {},
  extendFixtures: NormalizedFixtures = {},
): NormalizedFixtures => {
  const result = { ...extendFixtures };
  for (const key in fixtures) {
    const value: unknown = fixtures[key as keyof typeof fixtures];
    const parent = extendFixtures[key];
    let fixtureValue: unknown = value;
    let fixtureOptions: FixtureOptions | undefined;

    if (Array.isArray(value)) {
      if (value.length === 1 && typeof value[0] === 'function') {
        fixtureValue = value[0];
      } else if (
        isObject(value[1]) &&
        Object.keys(value[1]).some((key) => fixtureOptionKeys.includes(key))
      ) {
        fixtureValue = value[0];
        fixtureOptions = value[1] as FixtureOptions;
      }
    }

    result[key] = {
      isFn: typeof fixtureValue === 'function',
      value: fixtureValue,
      options: resolveFixtureOptions(key, fixtureOptions, parent),
      mode: 'use',
    };
  }

  return finalizeFixtures(result, Object.keys(result));
};

export const normalizeBuilderFixture = (
  name: string,
  value: unknown,
  options: FixtureOptions | undefined,
  extendFixtures: NormalizedFixtures = {},
): NormalizedFixtures => {
  const result = { ...extendFixtures };
  result[name] = {
    isFn: typeof value === 'function',
    value,
    options: resolveFixtureOptions(name, options, extendFixtures[name]),
    mode: 'return',
  };

  return finalizeFixtures(result, Object.keys(result));
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
type FixtureCleanupCallback = () => Promise<void>;

type FixtureInstance = {
  name: string;
  status: 'pending' | 'ready' | 'failed';
  value?: unknown;
  error?: unknown;
  setup?: Promise<void>;
  cancelled: boolean;
  cancelSetup?: () => void;
  teardownListeners: Set<() => void>;
};

type FixtureScopeContext = {
  instances: Map<NormalizedFixture, FixtureInstance>;
  cleanups: FixtureCleanupCallback[];
};

const preserveWorkerFixtureConsole = (
  fixture: NormalizedFixture,
  cleanup: FixtureCleanupCallback,
): FixtureCleanupCallback => {
  if (fixture.options.scope !== 'worker') {
    return cleanup;
  }

  const fixtureConsole = globalThis.console;
  return async () => {
    const currentConsole = globalThis.console;
    globalThis.console = fixtureConsole;
    try {
      await cleanup();
    } finally {
      globalThis.console = currentConsole;
    }
  };
};

const releaseFixtureSetupReferences = (instance: FixtureInstance) => {
  if (instance.status === 'pending') {
    return;
  }
  instance.setup = undefined;
  instance.cancelSetup = undefined;
  instance.teardownListeners.clear();
};

const createFixtureScopeContext = (
  cleanups: FixtureCleanupCallback[] = [],
): FixtureScopeContext => ({
  instances: new Map(),
  cleanups,
});

export class FixtureScopeManager {
  private readonly instances = new Map<NormalizedFixture, FixtureInstance>();
  private readonly cleanups: FixtureCleanupCallback[] = [];

  constructor(readonly scope: 'file' | 'worker') {}

  getContext(): FixtureScopeContext {
    return {
      instances: this.instances,
      cleanups: this.cleanups,
    };
  }

  async cleanup(): Promise<void> {
    const cleanups = this.cleanups.splice(0);
    this.instances.clear();
    const errors: unknown[] = [];

    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `Failed to clean up ${this.scope}-scoped fixtures.`,
      );
    }
  }
}

export const workerFixtureManager: FixtureScopeManager =
  new FixtureScopeManager('worker');

export const cleanupWorkerFixtures = (): Promise<void> =>
  workerFixtureManager.cleanup();

const callbackSources = new WeakMap<FixtureCallback, FixtureCallback>();
const fixturePropsCache = new WeakMap<
  FixtureCallback,
  { namedContext?: string[]; destructuredContext?: string[] }
>();
const functionPropertyNames = new Set(Object.getOwnPropertyNames(() => {}));

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
  managers: {
    file: FixtureScopeManager;
    worker: FixtureScopeManager;
  } = {
    file: new FixtureScopeManager('file'),
    worker: new FixtureScopeManager('worker'),
  },
): FixtureResolver => {
  const fixtures = test.fixtures ?? {};
  const failedFixtures = new Set<string>();
  const pendingInstances = new Set<FixtureInstance>();
  const testScopeContext = createFixtureScopeContext(cleanups);

  const getScopeContext = (fixture: NormalizedFixture): FixtureScopeContext => {
    if (fixture.options.scope === 'worker') {
      return managers.worker.getContext();
    }
    if (fixture.options.scope === 'file') {
      return managers.file.getContext();
    }
    return testScopeContext;
  };

  const setupUseFixture = (
    name: string,
    fixture: NormalizedFixture,
    fixtureContext: Record<string, unknown>,
    scopeContext: FixtureScopeContext,
    instance: FixtureInstance,
  ): Promise<unknown> =>
    new Promise((fixtureResolve, fixtureReject) => {
      let useDone: (() => void) | undefined;
      let blockSettled = false;
      let useCalled = false;
      instance.cancelSetup = () => {
        instance.cancelled = true;
        if (blockSettled) {
          fixtureResolve(undefined);
        }
      };

      const block = Promise.resolve().then(() =>
        fixture.value(fixtureContext, async (value: unknown) => {
          useCalled = true;
          if (instance.cancelled) {
            for (const listener of instance.teardownListeners) {
              listener();
            }
            return;
          }

          scopeContext.cleanups.unshift(
            preserveWorkerFixtureConsole(fixture, async () => {
              useDone?.();
              await block;
            }),
          );
          fixtureResolve(value);
          await new Promise<void>((resolve) => {
            useDone = resolve;
          });
        }),
      );

      block.then(() => {
        blockSettled = true;
        if (instance.cancelled) {
          fixtureResolve(undefined);
        } else if (!useCalled) {
          fixtureReject(
            new Error(`Fixture "${name}" did not call await use(value).`),
          );
        }
      }, fixtureReject);
    });

  const setupReturnFixture = async (
    name: string,
    fixture: NormalizedFixture,
    fixtureContext: Record<string, unknown>,
    scopeContext: FixtureScopeContext,
  ): Promise<unknown> => {
    let cleanupRegistered = false;
    const onCleanup = (cleanup: FixtureCleanup) => {
      if (cleanupRegistered) {
        throw new Error(
          `onCleanup can only be called once for fixture "${name}".`,
        );
      }
      cleanupRegistered = true;
      scopeContext.cleanups.unshift(
        preserveWorkerFixtureConsole(fixture, async () => {
          await cleanup();
        }),
      );
    };

    return fixture.value(fixtureContext, { onCleanup });
  };

  const useFixture = async (
    name: string,
    fixture: NormalizedFixture,
    stack: string[] = [],
  ): Promise<FixtureInstance> => {
    if (failedFixtures.has(name)) {
      throw new PreviouslyFailedFixtureError(name);
    }
    if (stack.includes(name)) {
      throw new Error(
        `Circular fixture dependency: ${[...stack, name].join(' -> ')}`,
      );
    }

    const scopeContext = getScopeContext(fixture);
    let instance = scopeContext.instances.get(fixture);
    if (instance?.status === 'ready') {
      context[name] = instance.value;
      return instance;
    }
    if (instance?.status === 'failed') {
      failedFixtures.add(name);
      throw instance.error;
    }
    if (instance) {
      pendingInstances.add(instance);
      try {
        await instance.setup;
      } catch (error) {
        failedFixtures.add(name);
        throw error;
      } finally {
        pendingInstances.delete(instance);
        releaseFixtureSetupReferences(instance);
      }
      context[name] = instance.value;
      return instance;
    }

    instance = {
      name,
      status: 'pending',
      cancelled: false,
      teardownListeners: new Set(),
    };
    scopeContext.instances.set(fixture, instance);
    const fixtureContext =
      fixture.options.scope === 'test'
        ? (context as Record<string, unknown>)
        : (Object.create(null) as Record<string, unknown>);

    instance.setup = (async () => {
      for (const dependencyName of fixture.deps ?? []) {
        const dependency = await useFixture(
          dependencyName,
          fixtures[dependencyName]!,
          [...stack, name],
        );
        fixtureContext[dependencyName] = dependency.value;
      }

      let value: unknown;
      if (!fixture.isFn) {
        value = fixture.value;
      } else if (fixture.mode === 'return') {
        value = await setupReturnFixture(
          name,
          fixture,
          fixtureContext,
          scopeContext,
        );
      } else {
        value = await setupUseFixture(
          name,
          fixture,
          fixtureContext,
          scopeContext,
          instance,
        );
      }

      if (instance.cancelled) {
        throw new PreviouslyFailedFixtureError(name);
      }
      instance.value = value;
      instance.status = 'ready';
    })().catch((error: unknown) => {
      instance.status = 'failed';
      instance.error = error;
      throw error;
    });

    pendingInstances.add(instance);
    try {
      await instance.setup;
    } catch (error) {
      failedFixtures.add(name);
      throw error;
    } finally {
      pendingInstances.delete(instance);
      releaseFixtureSetupReferences(instance);
    }

    context[name] = instance.value;
    return instance;
  };

  const resolveFixtureNames = async (
    usedKeys: string[],
    includeAuto: boolean,
  ) => {
    for (const [name, params] of Object.entries(fixtures)) {
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
      if (pendingInstances.size === 0) {
        return undefined;
      }
      const teardownStarted = new Promise<void>((notifyTeardownStarted) => {
        for (const instance of pendingInstances) {
          failedFixtures.add(instance.name);
          instance.teardownListeners.add(notifyTeardownStarted);
          instance.cancelSetup?.();
        }
      });
      return { teardownStarted };
    },
    resolveTestFixtures: (fn) =>
      test.fixtures
        ? resolveFixtureNames(fn ? getFixtureUsedProps(fn) : [], true)
        : Promise.resolve(),
    resolveHookFixtures: async (fn) => {
      try {
        const usedKeys = getFixtureUsedProps(fn, true);
        const missingFixture = usedKeys.find(
          (name) =>
            !Object.hasOwn(fixtures, name) &&
            (!Object.hasOwn(context, name) || functionPropertyNames.has(name)),
        );
        if (missingFixture) {
          throw new Error(
            `Hook has unknown fixture "${missingFixture}". Every test in the hook's suite must provide it.`,
          );
        }
        await resolveFixtureNames(usedKeys, false);
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
