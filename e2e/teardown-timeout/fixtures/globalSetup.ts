import { writeFile } from 'node:fs/promises';

export default function setup() {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await writeFile(process.env.TEARDOWN_MARKER!, 'teardown finished');
  };
}
