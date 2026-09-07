import { Buffer } from 'node:buffer';
import { afterAll } from '@rstest/core';
import type { ExtendConfig } from '@rstest/core';
import type { PlaywrightOptions } from './fixture';

const PLAYWRIGHT_CONFIG_SYMBOL = Symbol.for('rstest.playwright.config');

type ConfigEntry = {
  options: PlaywrightOptions;
};

type ConfigRegistry = {
  entries: ConfigEntry[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype;

const mergePlaywrightOptions = (base: unknown, override: unknown): unknown => {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergePlaywrightOptions(base[key], value);
  }
  return merged;
};

const assertSerializable = (
  value: unknown,
  ancestors: Set<object> = new Set(),
): void => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return;
    }
    throw new TypeError('Playwright config numbers must be finite.');
  }

  if (typeof value !== 'object') {
    throw new TypeError(
      'Playwright config only supports JSON-serializable values.',
    );
  }

  if (ancestors.has(value)) {
    throw new TypeError('Playwright config cannot contain circular values.');
  }

  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError(
      'Playwright config only supports arrays and plain objects.',
    );
  }

  ancestors.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    assertSerializable(item, ancestors);
  }
  ancestors.delete(value);
};

const getConfigRegistry = (): ConfigRegistry | undefined =>
  // This symbol is the runtime seam between the generated setup module and
  // the fixture bundle, which can be loaded through separate module graphs.
  Reflect.get(globalThis, PLAYWRIGHT_CONFIG_SYMBOL) as
    ConfigRegistry | undefined;

const getOrCreateConfigRegistry = (): ConfigRegistry => {
  const existing = getConfigRegistry();
  if (existing) {
    return existing;
  }

  const registry: ConfigRegistry = { entries: [] };
  Reflect.set(globalThis, PLAYWRIGHT_CONFIG_SYMBOL, registry);
  return registry;
};

/** @internal */
export const __registerPlaywrightConfig = (
  options: PlaywrightOptions,
): void => {
  const registry = getOrCreateConfigRegistry();
  const previous = registry.entries.at(-1)?.options;
  const entry: ConfigEntry = {
    options: mergePlaywrightOptions(previous, options) as PlaywrightOptions,
  };
  registry.entries.push(entry);

  afterAll(() => {
    const index = registry.entries.indexOf(entry);
    if (index !== -1) {
      registry.entries.splice(index, 1);
    }
    if (registry.entries.length === 0) {
      Reflect.deleteProperty(globalThis, PLAYWRIGHT_CONFIG_SYMBOL);
    }
  });
};

/** @internal */
export const getPlaywrightConfig = (): PlaywrightOptions | undefined =>
  getConfigRegistry()?.entries.at(-1)?.options;

/**
 * Configure the default `@rstest/playwright` fixture options from an Rstest
 * config file.
 */
export const definePlaywrightConfig = (
  options: PlaywrightOptions,
): ExtendConfig => {
  assertSerializable(options);
  const serializedOptions = JSON.stringify(options);
  const setupSource = `import { __registerPlaywrightConfig } from '@rstest/playwright/config';\n__registerPlaywrightConfig(${serializedOptions});`;

  return {
    setupFiles: [
      `data:text/javascript;base64,${Buffer.from(setupSource).toString('base64')}`,
    ],
  };
};
