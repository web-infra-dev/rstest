import type {
  FixtureCleanup,
  Fixtures,
  NormalizedFixture,
  NormalizedFixtures,
  TestCase,
  TestContext,
} from '../../types';
import { takeWorkerCleanups } from './workerCleanup';
import { isObject } from '../../utils/helper';

export { registerWorkerCleanup } from './workerCleanup';

export type FixtureScope = 'worker' | 'file' | 'test';

const namedFixtureNamePattern = /^[$A-Z_a-z][$\w]*$/;
const reservedNamedFixtureNames = new Set<string>([
  ...Object.keys({
    expect: true,
    onTestFailed: true,
    onTestFinished: true,
    signal: true,
    skip: true,
    task: true,
  } satisfies Record<keyof TestContext, true>),
  '_useLocalExpect',
]);

export const normalizeFixtures = (
  fixtures: Fixtures = {},
  extendFixtures: NormalizedFixtures = {},
): NormalizedFixtures => {
  const result: NormalizedFixtures = {};
  for (const key in fixtures) {
    if (extendFixtures[key]?.scope) {
      throw new Error(
        `The ${extendFixtures[key]!.scope}-scoped fixture "${key}" cannot be overridden.`,
      );
    }
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
          (property) =>
            Object.hasOwn(result, property) ||
            Object.hasOwn(extendFixtures, property),
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

export const normalizeNamedFixture = (
  name: string,
  value: unknown,
  extendFixtures: NormalizedFixtures = {},
  scope: FixtureScope = 'test',
): NormalizedFixtures => {
  if (
    !namedFixtureNamePattern.test(name) ||
    reservedNamedFixtureNames.has(name)
  ) {
    throw new Error(
      `Invalid named fixture name "${name}". Use a JavaScript identifier that does not conflict with the test context.`,
    );
  }
  const parent = extendFixtures[name];
  if (parent?.scope) {
    throw new Error(
      `The ${parent.scope}-scoped fixture "${name}" cannot be overridden.`,
    );
  }
  if (scope !== 'test' && parent) {
    throw new Error(
      `The ${scope}-scoped fixture "${name}" cannot override an existing fixture.`,
    );
  }
  const result: NormalizedFixtures = {
    ...extendFixtures,
    [name]: {
      isFn: typeof value === 'function',
      value,
      mode: 'return',
      scope: scope === 'test' ? undefined : scope,
    },
  };
  const fixture = result[name]!;
  if (fixture.isFn) {
    const usedProps = getFixtureUsedProps(fixture.value);
    if (scope !== 'test') {
      for (const property of usedProps) {
        if (property === name) {
          throw new Error(`Circular fixture dependency: ${name}`);
        }
        if (!Object.hasOwn(extendFixtures, property)) {
          throw new Error(
            `The ${scope}-scoped fixture "${name}" cannot depend on test context "${property}".`,
          );
        }
        const dependency = extendFixtures[property]!;
        const allowed =
          scope === 'worker'
            ? dependency.scope === 'worker'
            : dependency.scope === 'worker' || dependency.scope === 'file';
        if (!allowed) {
          throw new Error(
            `The ${scope}-scoped fixture "${name}" cannot depend on the ${dependency.scope ?? 'test'}-scoped fixture "${property}".`,
          );
        }
      }
      fixture.deps = usedProps;
    } else {
      fixture.deps = usedProps.filter((property) =>
        Object.hasOwn(result, property),
      );
    }
  }
  return result;
};

export type FixtureResolver = {
  cancelPendingFixtures: () => { teardownStarted: Promise<void> } | undefined;
  resolveTestFixtures: (fn?: (...args: any[]) => any) => Promise<void>;
  resolveHookFixtures: (
    fn: (...args: any[]) => any,
  ) => Promise<{ status: 'resolved' } | { status: 'skipped' }>;
};

type RunNamedFixtureSetup = <Value>(
  setup: () => Promise<Value>,
  onTimeout: () => void,
) => Promise<Value>;

type FixtureResolverOptions = {
  fileFixtureManager?: FileFixtureManager;
  workerFixtureManager?: FixtureScopeManager;
  runNamedFixtureSetup?: RunNamedFixtureSetup;
  wrapNamedFixtureCleanup?: (
    cleanup: () => Promise<void>,
  ) => () => Promise<void>;
};

type FixtureCleanupCallback = () => Promise<void>;

type FileFixtureInstance = {
  cleanup?: FixtureCleanupCallback;
  cleanupRegistered: boolean;
  dependents: Set<FileFixtureInstance>;
  error?: unknown;
  setup?: Promise<unknown>;
  start: () => Promise<unknown>;
  status: 'idle' | 'pending' | 'ready' | 'failed';
  teardownReady: Promise<void>;
  value?: unknown;
};

export class FixtureScopeManager {
  constructor(private readonly scope: 'worker' | 'file') {}

  private readonly instances = new Map<
    NormalizedFixture,
    FileFixtureInstance
  >();
  private cleaning = false;

  private getFixture(
    name: string,
    fixture: NormalizedFixture,
    fixtures: NormalizedFixtures,
  ): FileFixtureInstance {
    const existing = this.instances.get(fixture);
    if (existing) {
      return existing;
    }

    let notifyTeardownReady: (() => void) | undefined;
    const instance: FileFixtureInstance = {
      cleanupRegistered: false,
      dependents: new Set(),
      start: () => start(),
      status: 'idle',
      teardownReady: new Promise<void>((resolve) => {
        notifyTeardownReady = resolve;
      }),
    };
    this.instances.set(fixture, instance);

    const start = (): Promise<unknown> => {
      if (instance.setup) {
        return instance.setup;
      }
      instance.status = 'pending';
      instance.setup = Promise.resolve().then(async () => {
        const fixtureContext = Object.create(null) as Record<string, unknown>;
        for (const dependencyName of fixture.deps ?? []) {
          const dependencyDefinition = fixtures[dependencyName]!;
          const dependencyManager =
            dependencyDefinition.scope === 'worker' && this.scope === 'file'
              ? workerFixtureManager
              : this;
          const dependency = dependencyManager.getFixture(
            dependencyName,
            dependencyDefinition,
            fixtures,
          );
          if (dependencyManager === this) {
            dependency.dependents.add(instance);
          }
          await dependency.start();
          if (dependency.status === 'failed') {
            throw dependency.error;
          }
          fixtureContext[dependencyName] = dependency.value;
        }

        if (!fixture.isFn) {
          return fixture.value;
        }

        const onCleanup = (cleanup: FixtureCleanup) => {
          if (instance.cleanupRegistered) {
            throw new Error(
              `onCleanup can only be called once for fixture "${name}".`,
            );
          }
          instance.cleanupRegistered = true;
          let cleanupPromise: Promise<void> | undefined;
          const runCleanup = () => {
            cleanupPromise ??= Promise.resolve().then(cleanup);
            return cleanupPromise;
          };
          instance.cleanup = runCleanup;
          notifyTeardownReady?.();
          notifyTeardownReady = undefined;
        };

        return fixture.value(fixtureContext, { onCleanup });
      });
      instance.setup.then(
        (value) => {
          instance.status = 'ready';
          instance.value = value;
          notifyTeardownReady?.();
          notifyTeardownReady = undefined;
        },
        (error: unknown) => {
          instance.status = 'failed';
          instance.error = error;
          notifyTeardownReady?.();
          notifyTeardownReady = undefined;
        },
      );
      return instance.setup;
    };
    return instance;
  }

  async resolve(
    name: string,
    fixture: NormalizedFixture,
    fixtures: NormalizedFixtures,
    runSetup: RunNamedFixtureSetup,
  ): Promise<unknown> {
    if (this.cleaning) {
      throw new Error(
        `Cannot set up ${this.scope}-scoped fixture "${name}" during cleanup.`,
      );
    }
    const instance = this.getFixture(name, fixture, fixtures);
    await runSetup(
      () => instance.start(),
      () => {},
    );
    if (instance.status === 'failed') {
      throw instance.error;
    }
    return instance.value;
  }

  async cleanup(): Promise<void> {
    this.cleaning = true;
    const errors: unknown[] = [];
    const cleanupPromises = new Map<FileFixtureInstance, Promise<void>>();
    const cleanupInstance = (instance: FileFixtureInstance): Promise<void> => {
      const existing = cleanupPromises.get(instance);
      if (existing) {
        return existing;
      }
      const cleanup = Promise.resolve().then(async () => {
        if (instance.status === 'idle') {
          return;
        }
        await Promise.all([...instance.dependents].map(cleanupInstance));
        await instance.teardownReady;
        if (!instance.cleanup) {
          return;
        }
        try {
          await instance.cleanup();
        } catch (error) {
          errors.push(error);
        }
      });
      cleanupPromises.set(instance, cleanup);
      return cleanup;
    };

    await Promise.all([...this.instances.values()].map(cleanupInstance));
    this.instances.clear();
    this.cleaning = false;

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        [
          `Failed to clean up ${this.scope}-scoped fixtures.`,
          ...errors
            .map((error) =>
              error instanceof Error ? error.message : String(error),
            )
            .map((message) => `Fixture cleanup failed: ${message}`),
        ].join('\n'),
      );
    }
  }
}

export class FileFixtureManager extends FixtureScopeManager {
  constructor() {
    super('file');
  }
}

export const workerFixtureManager: FixtureScopeManager =
  new FixtureScopeManager('worker');

export const cleanupWorkerFixtures = async (): Promise<void> => {
  const errors: unknown[] = [];

  try {
    await workerFixtureManager.cleanup();
  } catch (error) {
    errors.push(error);
  }

  const cleanups = takeWorkerCleanups();
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
      [
        'Failed to clean up worker resources.',
        ...errors
          .map((error) =>
            error instanceof Error ? error.message : String(error),
          )
          .map((message) => `Worker cleanup failed: ${message}`),
      ].join('\n'),
    );
  }
};

class PreviouslyFailedFixtureError extends Error {}

type FixtureCallback = (...args: any[]) => any;

const callbackSources = new WeakMap<FixtureCallback, FixtureCallback>();
const fixturePropsCache = new WeakMap<
  FixtureCallback,
  { namedContext?: string[]; destructuredContext?: string[] }
>();
const functionPropertyNames = new Set(Object.getOwnPropertyNames(() => {}));

const setFixtureContextValue = (
  context: Record<string, any>,
  name: string,
  value: unknown,
) => {
  Object.defineProperty(context, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};

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
  options: FixtureResolverOptions = {},
): FixtureResolver => {
  const runNamedFixtureSetupWithoutTimeout: RunNamedFixtureSetup = (setup) =>
    setup();
  const wrapNamedFixtureCleanup =
    options.wrapNamedFixtureCleanup ?? ((cleanup) => cleanup);
  const fixtures = test.fixtures ?? {};
  const doneMap = new Set<string>();
  const cancelledFixtures = new Set<string>();
  const failedFixtures = new Set<string>();
  const pendingMap = new Set<string>();
  const cancelFixtureSetups = new Map<string, () => void>();
  const cancelledFixtureTeardownStarts = new Map<string, () => void>();

  const useFixture = async (
    name: string,
    fixture: NormalizedFixture,
    runNamedFixtureSetup: RunNamedFixtureSetup,
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

    if (fixture.scope) {
      const fixtureManager =
        fixture.scope === 'worker'
          ? options.workerFixtureManager
          : options.fileFixtureManager;
      if (!fixtureManager) {
        throw new Error(`${fixture.scope} fixture manager is not available.`);
      }
      pendingMap.add(name);
      let cancelWait: (() => void) | undefined;
      const cancelled = new Promise<{ status: 'cancelled' }>((resolve) => {
        cancelWait = () => resolve({ status: 'cancelled' });
      });
      cancelFixtureSetups.set(name, () => {
        cancelledFixtureTeardownStarts.get(name)?.();
        cancelWait?.();
      });
      try {
        const resolved = fixtureManager
          .resolve(name, fixture, fixtures, runNamedFixtureSetup)
          .then((value) => ({ status: 'resolved' as const, value }));
        const resolution = await Promise.race([resolved, cancelled]);
        if (resolution.status === 'cancelled') {
          throw new PreviouslyFailedFixtureError(name);
        }
        setFixtureContextValue(context, name, resolution.value);
        doneMap.add(name);
      } catch (error) {
        failedFixtures.add(name);
        throw error;
      } finally {
        pendingMap.delete(name);
        cancelFixtureSetups.delete(name);
        cancelledFixtureTeardownStarts.delete(name);
      }
      return;
    }

    const { isFn, deps, mode, value: fixtureValue } = fixture;
    if (!isFn) {
      setFixtureContextValue(context, name, fixtureValue);
      doneMap.add(name);
      return;
    }

    pendingMap.add(name);
    try {
      if (deps?.length) {
        for (const dep of deps) {
          await useFixture(dep, fixtures[dep]!, runNamedFixtureSetup);
        }
      }

      if (mode === 'return') {
        let registeredCleanup: (() => Promise<void>) | undefined;
        let cleanupPromise: Promise<void> | undefined;
        let cleanupExecutionPromise: Promise<void> | undefined;
        let resolveCancellationCleanup: (() => void) | undefined;
        let rejectCancellationCleanup: ((error: unknown) => void) | undefined;
        const cancellationCleanup = new Promise<void>((resolve, reject) => {
          resolveCancellationCleanup = resolve;
          rejectCancellationCleanup = reject;
        });
        const notifyTeardownStarted = () => {
          cancelledFixtureTeardownStarts.get(name)?.();
        };
        const runRegisteredCleanup = (
          removeFromCleanupQueue = true,
        ): Promise<void> | undefined => {
          if (!registeredCleanup) {
            return undefined;
          }
          if (removeFromCleanupQueue) {
            const cleanupIndex = cleanups.indexOf(registeredCleanup);
            if (cleanupIndex !== -1) {
              cleanups.splice(cleanupIndex, 1);
            }
          }
          if (!cleanupExecutionPromise) {
            cleanupExecutionPromise = registeredCleanup();
            cleanupExecutionPromise.catch(() => undefined);
          }
          return cleanupExecutionPromise;
        };
        const trackCancellationCleanup = () => {
          const cleanup = runRegisteredCleanup();
          cleanup?.then(resolveCancellationCleanup, rejectCancellationCleanup);
        };

        cancelFixtureSetups.set(name, () => {
          trackCancellationCleanup();
        });

        let cleanupRegistered = false;
        let setupTimedOut = false;
        let resolveLateCleanupRegistration:
          ((cleanup: (() => Promise<void>) | undefined) => void) | undefined;
        const lateCleanupRegistration = new Promise<
          (() => Promise<void>) | undefined
        >((resolve) => {
          resolveLateCleanupRegistration = resolve;
        });
        const resolveLateCleanup = (
          cleanup: (() => Promise<void>) | undefined,
        ) => {
          const resolve = resolveLateCleanupRegistration;
          resolveLateCleanupRegistration = undefined;
          resolve?.(cleanup);
          return Boolean(resolve);
        };
        const onCleanup = (cleanup: FixtureCleanup) => {
          if (cleanupRegistered) {
            throw new Error(
              `onCleanup can only be called once for fixture "${name}".`,
            );
          }
          cleanupRegistered = true;
          registeredCleanup = wrapNamedFixtureCleanup(async () => {
            if (!cleanupPromise) {
              notifyTeardownStarted();
              cleanupPromise = Promise.resolve().then(cleanup);
              cleanupPromise.catch(() => undefined);
            }
            return cleanupPromise;
          });
          if (cancelledFixtures.has(name)) {
            if (setupTimedOut) {
              if (!resolveLateCleanup(registeredCleanup)) {
                runRegisteredCleanup(false);
              }
            } else {
              trackCancellationCleanup();
            }
          } else {
            cleanups.unshift(registeredCleanup);
          }
        };

        const setup = runNamedFixtureSetup(
          () => {
            const setupOperation = Promise.resolve(
              fixtureValue(context, { onCleanup }),
            );
            const resolveWithoutCleanup = () => {
              if (!cleanupRegistered) {
                resolveLateCleanup(undefined);
              }
            };
            setupOperation.then(resolveWithoutCleanup, resolveWithoutCleanup);
            return setupOperation;
          },
          () => {
            setupTimedOut = true;
            cancelledFixtures.add(name);
            const cleanup = runRegisteredCleanup(false);
            if (!cleanup) {
              const waitForLateCleanup = wrapNamedFixtureCleanup(async () => {
                const lateCleanup = await lateCleanupRegistration;
                await lateCleanup?.();
              });
              cleanups.unshift(async () => {
                try {
                  await waitForLateCleanup();
                } catch (error) {
                  if (registeredCleanup) {
                    throw error;
                  }
                }
              });
            }
          },
        );
        const value = await Promise.race([setup, cancellationCleanup]);
        if (!cancelledFixtures.has(name)) {
          setFixtureContextValue(context, name, value);
        }
        if (cancelledFixtures.has(name)) {
          const cleanup = runRegisteredCleanup();
          if (cleanup) {
            await cleanup;
          }
        }
      } else {
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
              setFixtureContextValue(context, name, value);
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
      }

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
    runNamedFixtureSetup: RunNamedFixtureSetup = runNamedFixtureSetupWithoutTimeout,
  ) => {
    for (const [name, params] of Object.entries(fixtures)) {
      const shouldResolve =
        usedKeys.includes(name) || (includeAuto && params.options?.auto);
      if (!shouldResolve) {
        continue;
      }

      await useFixture(name, params, runNamedFixtureSetup);
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
      test.fixtures
        ? resolveFixtureNames(
            fn ? getFixtureUsedProps(fn) : [],
            true,
            options.runNamedFixtureSetup,
          )
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
