import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export let condition;
try {
  condition = require('#sync-condition');
} catch (error) {
  condition = { code: error.code };
}

export const value = 'fixture-pkg-value';
