import { defineConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

export default defineConfig({
  include: ['lifecycle.test.ts'],
  reporters: [new LifecycleRecorder()],
});
