import { defineConfig } from '@rstest/core';

// The watch regression test drives stdin through a pipe.
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;

// Each browser project fails independently so the shared setup stage must
// preserve every error instead of reporting only the first project.
export default defineConfig({
  projects: ['./project-a/rstest.config.mts', './project-b/rstest.config.mts'],
});
