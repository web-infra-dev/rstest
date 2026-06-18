import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const registerFlagPath = fileURLToPath(
  new URL('./register-loaded.txt', import.meta.url),
);

await import('node:fs/promises').then(({ writeFile }) =>
  writeFile(registerFlagPath, 'loaded', 'utf-8'),
);

register('./ts-register-loader.mjs', import.meta.url);

process.env.RUNTIME_REGISTER_FLAG_PATH = registerFlagPath;
