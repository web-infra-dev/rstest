import { resolve } from 'node:path';
import { defineConfig, type Reporter } from '@rstest/core';

const hooks: string[] = [];
let errors: Parameters<
  NonNullable<Reporter['onTestRunEnd']>
>[0]['unhandledErrors'];
const reporter: Reporter = {
  onTestRunStart() {
    hooks.push('onTestRunStart');
  },
  onTestRunEnd({ unhandledErrors }) {
    hooks.push('onTestRunEnd');
    errors = unhandledErrors;
  },
  onExit() {
    hooks.push('onExit');
    console.log(`__LIFECYCLE__${JSON.stringify({ hooks, errors })}__END__`);
  },
};

export default defineConfig({
  reporters: ['default', reporter],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    // Launch fails before the OS-assigned port matters; no BROWSER_PORTS entry.
    port: 0,
    providerOptions: {
      launch: { executablePath: resolve('nonexistent-browser-binary') },
    },
  },
  include: ['index.test.ts'],
});
