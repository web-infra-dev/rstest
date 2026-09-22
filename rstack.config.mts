import { define } from 'rstack';

define.fmt({
  singleQuote: true,
  sortPackageJson: true,
  ignorePatterns: [
    'dist',
    'compiled',
    'doc_build',
    // Package builds format these generated bundles with Prettier, including on Node 20.
    'LICENSE.md',
    '!package-lock.json',
    '!skills-lock.json',
  ],
});
