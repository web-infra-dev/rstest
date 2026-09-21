import { existsSync } from 'node:fs';

export default {
  apply(compiler) {
    compiler.hooks.afterCompile.tap('fatal-rebuild', () => {
      if (existsSync('fatal.marker')) {
        throw new Error('rebuild compile exploded');
      }
    });
  },
};
