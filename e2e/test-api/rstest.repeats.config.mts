import { defineConfig } from '@rstest/core';

export default defineConfig({
  repeats: 2,
  include: ['fixtures/testOptionsRepeatsPass.test.ts'],
});
