import { defineConfig } from '@rstest/core';

export default defineConfig({
  // A user `onConsoleLog` filter that throws. The worker forwards console output
  // fire-and-forget (it never awaits the result), so this host-side error cannot
  // travel back to the worker — the host must surface it as a diagnostic without
  // failing the (passing) test.
  onConsoleLog: () => {
    throw new Error('onConsoleLog hook boom');
  },
});
