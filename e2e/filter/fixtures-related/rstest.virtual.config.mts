import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const virtualDependencyPath = fileURLToPath(
  new URL('./src/virtualDependency.ts', import.meta.url),
);
const setupSource = `import ${JSON.stringify(virtualDependencyPath)};`;

export default defineConfig({
  include: ['**/*.test.ts'],
  setupFiles: [
    `data:text/javascript;base64,${Buffer.from(setupSource).toString('base64')}`,
  ],
});
