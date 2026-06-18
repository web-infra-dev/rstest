import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';

const registerFlagPath = join(tmpdir(), `rstest-register-${process.pid}.txt`);

await writeFile(registerFlagPath, 'loaded', 'utf-8');

register('./ts-register-loader.mjs', import.meta.url);

process.env.RUNTIME_REGISTER_FLAG_PATH = registerFlagPath;
