import type { PoolWorkerKind } from './types';

const isPlainJsonObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === null ||
    (Object.getPrototypeOf(prototype) === null &&
      prototype.constructor?.name === 'Object')
  );
};

const assertJsonCompatible = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): void => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new TypeError('non-finite numbers are not JSON-compatible');
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${typeof value} values are not JSON-compatible`);
  }
  if (seen.has(value)) {
    throw new TypeError('circular references are not JSON-compatible');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonCompatible(item, seen);
    }
  } else {
    if (!isPlainJsonObject(value) || 'toJSON' in value) {
      throw new TypeError(
        `${Object.prototype.toString.call(value)} values are not JSON-compatible`,
      );
    }
    for (const item of Object.values(value)) {
      assertJsonCompatible(item, seen);
    }
  }

  seen.delete(value);
};

/**
 * Node worker tasks cross an IPC structured-clone boundary, while Bun fork
 * workers use JSON serialization. Keep this check host-side so an unsupported
 * environment option fails before a task is dispatched and is not reported as
 * a worker crash.
 */
export const assertWorkerEnvironmentOptions = (
  options: Record<string, unknown> | undefined,
  workerKind: PoolWorkerKind = 'forks',
): void => {
  try {
    structuredClone(options ?? {});
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(
      'Node worker pools require `testEnvironment.options` to be structured-cloneable because the options are sent to a worker.' +
        ' Use cloneable values or move equivalent callback setup into a setup file.' +
        reason,
    );
  }

  if (
    process.versions.bun !== undefined &&
    (workerKind === 'forks' || workerKind === 'vmForks')
  ) {
    try {
      assertJsonCompatible(options ?? {});
    } catch (error) {
      const reason = error instanceof Error ? ` ${error.message}` : '';
      throw new Error(
        'Bun fork pools require `testEnvironment.options` to be JSON-compatible because their IPC uses JSON serialization.' +
          reason,
      );
    }
  }
};
