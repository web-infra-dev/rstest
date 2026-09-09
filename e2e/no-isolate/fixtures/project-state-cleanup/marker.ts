import { join } from 'node:path';

export const projectAFinishedMarker = join(
  process.cwd(),
  '.project-a-finished',
);
