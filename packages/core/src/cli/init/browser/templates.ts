import type { Agent } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';

export type Framework = 'react' | 'vanilla';
export type BrowserProvider = 'playwright';

/**
 * Get rstest.config.ts template content.
 */
export function getConfigTemplate(): string {
  return `import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
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
import { render } from '@rstest/browser-react';
import Counter from './Counter.${componentExt}';

test('increments count on button click', async () => {
  const screen = await render(<Counter initial={5} />);

  await expect.element(screen.getByText('Count: 5')).toBeInTheDocument();

  await screen.getByRole('button', { name: 'Increment' }).click();
  await expect.element(screen.getByText('Count: 6')).toBeInTheDocument();
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

  await expect.element(page.getByText('Count: 5')).toBeInTheDocument();

  await page.getByRole('button', { name: 'Increment' }).click();
  await expect.element(page.getByText('Count: 6')).toBeInTheDocument();
});
`;
}

/**
 * Get the dependencies that need to be installed.
 */
export function getDependencies(framework: Framework): string[] {
  const deps = ['@rstest/browser', 'playwright', '@testing-library/dom'];
  if (framework === 'react') {
    deps.splice(1, 0, '@rstest/browser-react');
  }
  return deps;
}

/**
 * Get the dependencies with versions.
 * @param rstestVersion The current rstest version to use for rstest packages
 */
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
    deps.playwright = '^1.49.0';
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

/**
 * Get run command for the package manager.
 */
export function getRunCommand(agent: Agent): string {
  const resolved = resolveCommand(agent, 'run', ['test:browser']);
  if (!resolved) {
    return 'npm run test:browser';
  }
  return [resolved.command, ...resolved.args].join(' ');
}

/**
 * Get the config file name to create.
 */
export function getConfigFileName(): string {
  return 'rstest.browser.config.ts';
}
