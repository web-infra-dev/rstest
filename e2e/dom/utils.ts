import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const runCli = async (
  _filters: string | string[],
  testEnvironment?: 'jsdom' | 'happy-dom' | string,
  extra?: {
    args?: string[];
  },
) => {
  const filters = Array.isArray(_filters) ? _filters : [_filters];
  return await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      ...(testEnvironment ? [`--testEnvironment=${testEnvironment}`] : []),
      ...(extra?.args || []),
      ...filters,
    ],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });
};
