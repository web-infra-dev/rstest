import type { Rstest } from '@rstest/core/browser';
import { resolveBrowserViewportPreset } from './viewportPresets';

const SUPPORTED_PROVIDERS = ['playwright'] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]';
};

const validateViewport = (viewport: unknown): void => {
  if (viewport == null) {
    return;
  }

  if (typeof viewport === 'string') {
    const presetId = viewport.trim();
    if (!presetId) {
      throw new Error('browser.viewport must be a non-empty preset id.');
    }
    if (!resolveBrowserViewportPreset(presetId)) {
      throw new Error(
        `browser.viewport must be a valid preset id. Received: ${viewport}`,
      );
    }
    return;
  }

  if (isPlainObject(viewport)) {
    const width = (viewport as any).width;
    const height = (viewport as any).height;
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error('browser.viewport.width must be a positive number.');
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error('browser.viewport.height must be a positive number.');
    }
    return;
  }

  throw new Error(
    'browser.viewport must be either a preset id or { width, height }.',
  );
};

export const validateBrowserConfig = (context: Rstest): void => {
  for (const project of context.projects) {
    const browser = project.normalizedConfig.browser;
    if (!browser.enabled) {
      continue;
    }

    if (!browser.provider) {
      throw new Error(
        'browser.provider is required when browser.enabled is true.',
      );
    }

    if (!SUPPORTED_PROVIDERS.includes(browser.provider)) {
      throw new Error(
        `browser.provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
    }

    validateViewport(browser.viewport);
  }
};
