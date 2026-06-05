import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'named-project',
  include: ['**/fixtures/agent-md-pass/**'],
});
