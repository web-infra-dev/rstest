import type { Agent } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import {
  BROWSER_PROVIDERS,
  type BrowserProvider,
} from '../../../utils/constants';

export type Framework = 'react' | 'vanilla';
export type { BrowserProvider };

/** Base name of the example component emitted by the init templates. */
export const DEFAULT_COMPONENT_BASE_NAME = 'Counter';

/**
 * Collapses a detected framework (which may be undetected/`null`) into the
 * concrete template family. Single owner of the `react ? react : vanilla`
 * decision that the interactive, non-interactive, preview, and generate paths
 * previously each re-encoded.
 */
export function resolveEffectiveFramework(
  framework: 'react' | null,
): Framework {
  return framework === 'react' ? 'react' : 'vanilla';
}

/**
 * Owns the framework + language → file-extension matrix shared by the file
 * preview and the file generation step (previously duplicated verbatim in both).
 */
export function getFileExtensions(
  framework: Framework,
  language: 'ts' | 'js',
): { componentExt: string; testExt: string } {
  if (framework === 'react') {
    return {
      componentExt: language === 'ts' ? '.tsx' : '.jsx',
      testExt: language === 'ts' ? '.test.tsx' : '.test.jsx',
    };
  }
  return {
    componentExt: language === 'ts' ? '.ts' : '.js',
    testExt: language === 'ts' ? '.test.ts' : '.test.js',
  };
}

/**
 * Rewrites the example-component import in a generated test file to follow a
 * deduplicated base name. The test templates always import from
 * `./Counter.<ext>`; when the component is written under a non-default name
 * (e.g. `Counter_1`), the import must track it. Owns the `Counter` literal and
 * the extension-agnostic import grammar so {@link getReactTestTemplate} /
 * {@link getVanillaTestTemplate} and the caller no longer re-encode either.
 */
export function rewriteComponentImport(
  content: string,
  baseName: string,
): string {
  if (baseName === DEFAULT_COMPONENT_BASE_NAME) {
    return content;
  }
  return content.replace(
    /from '\.\/Counter\.(tsx|jsx|ts|js)'/,
    `from './${baseName}.$1'`,
  );
}

/**
 * Get rstest.config.mts template content.
 */
export function getConfigTemplate(): string {
  return `import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: '${BROWSER_PROVIDERS[0]}',
  },
});
`;
}

/**
 * Get React component template.
 */
export function getReactComponentTemplate(lang: 'ts' | 'js'): string {
  if (lang === 'ts') {
    return `import { useState } from 'react';

export default function Counter({ initial = 0 }: { initial?: number }) {
  const [count, setCount] = useState(initial);

  return (
    <div>
      <p>Count: {count}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Increment
      </button>
      <button type="button" onClick={() => setCount((c) => c - 1)}>
        Decrement
      </button>
    </div>
  );
}
`;
  }

  return `import { useState } from 'react';

export default function Counter({ initial = 0 }) {
  const [count, setCount] = useState(initial);

  return (
    <div>
      <p>Count: {count}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Increment
      </button>
      <button type="button" onClick={() => setCount((c) => c - 1)}>
        Decrement
      </button>
    </div>
  );
}
`;
}

/**
 * Get React test file template.
 */
export function getReactTestTemplate(lang: 'ts' | 'js'): string {
  const componentExt = lang === 'ts' ? 'tsx' : 'jsx';

  return `import { expect, test } from '@rstest/core';
import { page } from '@rstest/browser';
 import { render } from '@rstest/browser-react';
 import Counter from './Counter.${componentExt}';
 
 test('increments count on button click', async () => {
  await render(<Counter initial={5} />);

  await expect.element(page.getByText('Count: 5')).toBeVisible();

  await page.getByRole('button', { name: 'Increment' }).click();
  await expect.element(page.getByText('Count: 6')).toBeVisible();
 });
 `;
}

/**
 * Get vanilla DOM component template.
 */
export function getVanillaComponentTemplate(lang: 'ts' | 'js'): string {
  if (lang === 'ts') {
    return `export function createCounter(initial = 0): HTMLElement {
  let count = initial;

  const container = document.createElement('div');
  const display = document.createElement('p');
  const incBtn = document.createElement('button');
  const decBtn = document.createElement('button');

  display.textContent = \`Count: \${count}\`;
  incBtn.textContent = 'Increment';
  decBtn.textContent = 'Decrement';

  incBtn.addEventListener('click', () => {
    count++;
    display.textContent = \`Count: \${count}\`;
  });

  decBtn.addEventListener('click', () => {
    count--;
    display.textContent = \`Count: \${count}\`;
  });

  container.append(display, incBtn, decBtn);
  return container;
}
`;
  }

  return `export function createCounter(initial = 0) {
  let count = initial;

  const container = document.createElement('div');
  const display = document.createElement('p');
  const incBtn = document.createElement('button');
  const decBtn = document.createElement('button');

  display.textContent = \`Count: \${count}\`;
  incBtn.textContent = 'Increment';
  decBtn.textContent = 'Decrement';

  incBtn.addEventListener('click', () => {
    count++;
    display.textContent = \`Count: \${count}\`;
  });

  decBtn.addEventListener('click', () => {
    count--;
    display.textContent = \`Count: \${count}\`;
  });

  container.append(display, incBtn, decBtn);
  return container;
}
`;
}

/**
 * Get vanilla DOM test file template.
 */
export function getVanillaTestTemplate(lang: 'ts' | 'js'): string {
  const ext = lang === 'ts' ? 'ts' : 'js';

  return `import { expect, test } from '@rstest/core';
import { page } from '@rstest/browser';
import { createCounter } from './Counter.${ext}';

 test('increments count on button click', async () => {
   document.body.appendChild(createCounter(5));
 
   await expect.element(page.getByText('Count: 5')).toBeVisible();
 
   await page.getByRole('button', { name: 'Increment' }).click();
   await expect.element(page.getByText('Count: 6')).toBeVisible();
 });
 `;
}

export function getDependenciesWithVersions(
  framework: Framework,
  provider: BrowserProvider,
  rstestVersion: string,
): Record<string, string> {
  const deps: Record<string, string> = {
    '@rstest/browser': `^${rstestVersion}`,
    '@testing-library/dom': '^10.0.0',
  };

  // Currently we only support Playwright, keep this switch
  // so it's easy to extend providers in the future.
  if (provider === 'playwright') {
    deps.playwright = PLAYWRIGHT_VERSION;
  }
  if (framework === 'react') {
    deps['@rstest/browser-react'] = `^${rstestVersion}`;
  }
  return deps;
}

/**
 * Get install command for the package manager.
 */
export function getInstallCommand(agent: Agent): string {
  const resolved = resolveCommand(agent, 'install', []);
  if (!resolved) {
    return 'npm install';
  }
  return [resolved.command, ...resolved.args].join(' ');
}

/**
 * Get Playwright browsers install command.
 */
export function getPlaywrightInstallCommand(
  agent: Agent,
  _provider: BrowserProvider,
): string {
  const resolved = resolveCommand(agent, 'execute', [
    'playwright',
    'install',
    '--with-deps',
  ]);
  if (!resolved) {
    return 'npx playwright install --with-deps';
  }
  return [resolved.command, ...resolved.args].join(' ');
}

/** package.json script key registered by the browser-mode init flow. */
export const BROWSER_TEST_SCRIPT_KEY = 'test:browser';

/**
 * Get run command for the package manager.
 */
export function getRunCommand(agent: Agent): string {
  const resolved = resolveCommand(agent, 'run', [BROWSER_TEST_SCRIPT_KEY]);
  if (!resolved) {
    return `npm run ${BROWSER_TEST_SCRIPT_KEY}`;
  }
  return [resolved.command, ...resolved.args].join(' ');
}

/**
 * Get the config file name to create.
 */
export function getConfigFileName(): string {
  return 'rstest.browser.config.mts';
}

/**
 * The `test:browser` package.json script command. Composed from
 * {@link getConfigFileName} at call time so the config filename has exactly one
 * owner — the script value can never drift from the file actually written.
 */
export function getBrowserTestScript(): string {
  return `rstest --config=${getConfigFileName()}`;
}
